import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { ListInput, Team } from "@ftp/shared";

/** A saved character list (DynamoDB `LIST#<id>` / `META`). */
export type StoredList = Omit<ListInput, "atlas"> & {
  id: string;
  atlas: ListInput["atlas"];
  editTokenHash: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  hidden?: boolean;
};

/** What a saved team keeps of each character it uses, so its link survives list edits. */
export type CharacterSnapshot = { name: string; twoWay: boolean; atlasIndex: number };

/** A saved team (`TEAM#<id>` / `META`): immutable once written. */
export type StoredTeam = Team & {
  schema: 1;
  id: string;
  listVersion: number;
  listTitle: string;
  atlas: { src: string; tile: number; columns: number; count: number };
  characters: Record<string, CharacterSnapshot>;
  disclaimer?: string;
  createdAt: string;
};

export type StoredReport = {
  targetId: string;
  targetType: "list" | "team";
  reason: string;
  ipHash: string;
  createdAt: string;
};

export class VersionConflict extends Error {}

export interface Store {
  getList(id: string): Promise<StoredList | null>;
  /** Create (expectVersion undefined: must not exist) or update (must be at expectVersion). */
  putList(list: StoredList, expectVersion?: number): Promise<void>;
  deleteList(id: string): Promise<void>;
  getTeam(id: string): Promise<StoredTeam | null>;
  /** Teams are immutable: fails if the id exists. */
  putTeam(team: StoredTeam): Promise<void>;
  putReport(report: StoredReport): Promise<void>;
  /** Public, non-hidden lists, newest first (GSI1), for the browse index. */
  publicLists(): Promise<StoredList[]>;
}

export class MemoryStore implements Store {
  lists = new Map<string, StoredList>();
  teams = new Map<string, StoredTeam>();
  reports: StoredReport[] = [];

  async getList(id: string) {
    return structuredClone(this.lists.get(id) ?? null);
  }
  async putList(list: StoredList, expectVersion?: number) {
    const current = this.lists.get(list.id);
    if (expectVersion === undefined ? current : current?.version !== expectVersion)
      throw new VersionConflict(list.id);
    this.lists.set(list.id, structuredClone(list));
  }
  async deleteList(id: string) {
    this.lists.delete(id);
  }
  async getTeam(id: string) {
    return structuredClone(this.teams.get(id) ?? null);
  }
  async putTeam(team: StoredTeam) {
    if (this.teams.has(team.id)) throw new VersionConflict(team.id);
    this.teams.set(team.id, structuredClone(team));
  }
  async putReport(report: StoredReport) {
    this.reports.push(report);
  }
  async publicLists() {
    return [...this.lists.values()]
      .filter((l) => l.visibility === "public" && !l.hidden)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

/** Single-table DynamoDB store (#9 data model). */
export class DynamoStore implements Store {
  private db: DynamoDBDocumentClient;

  constructor(
    private table: string,
    client = new DynamoDBClient({}),
  ) {
    this.db = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async getList(id: string) {
    const r = await this.db.send(
      new GetCommand({ TableName: this.table, Key: { PK: `LIST#${id}`, SK: "META" } }),
    );
    return r.Item ? strip<StoredList>(r.Item) : null;
  }

  async putList(list: StoredList, expectVersion?: number) {
    const browse = list.visibility === "public" && !list.hidden;
    try {
      await this.db.send(
        new PutCommand({
          TableName: this.table,
          Item: {
            PK: `LIST#${list.id}`,
            SK: "META",
            ...(browse ? { GSI1PK: "PUBLIC", GSI1SK: list.createdAt } : {}),
            ...list,
          },
          ...(expectVersion === undefined
            ? { ConditionExpression: "attribute_not_exists(PK)" }
            : {
                ConditionExpression: "version = :v",
                ExpressionAttributeValues: { ":v": expectVersion },
              }),
        }),
      );
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) throw new VersionConflict(list.id);
      throw e;
    }
  }

  async deleteList(id: string) {
    await this.db.send(
      new DeleteCommand({ TableName: this.table, Key: { PK: `LIST#${id}`, SK: "META" } }),
    );
  }

  async getTeam(id: string) {
    const r = await this.db.send(
      new GetCommand({ TableName: this.table, Key: { PK: `TEAM#${id}`, SK: "META" } }),
    );
    return r.Item ? strip<StoredTeam>(r.Item) : null;
  }

  async putTeam(team: StoredTeam) {
    try {
      await this.db.send(
        new PutCommand({
          TableName: this.table,
          Item: { PK: `TEAM#${team.id}`, SK: "META", ...team },
          ConditionExpression: "attribute_not_exists(PK)",
        }),
      );
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) throw new VersionConflict(team.id);
      throw e;
    }
  }

  async putReport(report: StoredReport) {
    await this.db.send(
      new PutCommand({
        TableName: this.table,
        Item: { PK: `REPORT#${report.targetId}`, SK: report.createdAt, ...report },
      }),
    );
  }

  async publicLists() {
    const out: StoredList[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const r = await this.db.send(
        new QueryCommand({
          TableName: this.table,
          IndexName: "GSI1",
          KeyConditionExpression: "GSI1PK = :p",
          ExpressionAttributeValues: { ":p": "PUBLIC" },
          ScanIndexForward: false,
          ExclusiveStartKey: start,
        }),
      );
      out.push(...(r.Items ?? []).map((i) => strip<StoredList>(i)));
      start = r.LastEvaluatedKey;
    } while (start);
    return out;
  }
}

function strip<T>(item: Record<string, unknown>): T {
  const { PK: _pk, SK: _sk, GSI1PK: _gpk, GSI1SK: _gsk, ...rest } = item;
  return rest as T;
}
