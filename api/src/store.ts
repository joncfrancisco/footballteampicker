import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  BatchGetCommand,
  type BatchGetCommandInput,
} from "@aws-sdk/lib-dynamodb";
import type { ListInput, Team } from "@ftp/shared";

/** A saved character list (DynamoDB `LIST#<id>` / `META`). */
export type StoredList = Omit<ListInput, "atlas"> & {
  disclaimer?: string;
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
  hidden?: boolean;
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
  status?: "open" | "resolved";
  targetId: string;
  targetType: "list" | "team";
  reason: string;
  ipHash: string;
  createdAt: string;
  /** Set by the moderation commands when the report is resolved (#51). */
  action?: "takedown" | "dismiss" | "restore";
  resolvedBy?: string;
  resolvedAt?: string;
  note?: string;
};

/** GSI1 partitions for reports: open ones by `createdAt`, resolved ones by `resolvedAt`. */
export const OPEN_REPORTS = "REPORT#open";
export const RESOLVED_REPORTS = "REPORT#resolved";

export class VersionConflict extends Error {}

export type UploadSession = {
  key: string;
  tokenHash: string;
  contentType: string;
  expiresAt: number;
};

export interface Store {
  consumeRate(key: string, limit: number, expiresAt: number): Promise<boolean>;
  putUpload(session: UploadSession): Promise<void>;
  claimUpload(key: string, tokenHash: string, now: number): Promise<boolean>;
  getList(id: string): Promise<StoredList | null>;
  /** Create (expectVersion undefined: must not exist) or update (must be at expectVersion). */
  putList(list: StoredList, expectVersion?: number): Promise<void>;
  deleteList(id: string): Promise<void>;
  getTeam(id: string): Promise<StoredTeam | null>;
  /** Teams are immutable: fails if the id exists. */
  putTeam(team: StoredTeam): Promise<void>;
  putReport(report: StoredReport): Promise<boolean>;
  reportCount(type: "list" | "team", id: string): Promise<number>;
  hideList(id: string): Promise<boolean>;
  /** Public, non-hidden lists, newest first (GSI1), for the browse index. */
  publicLists(): Promise<StoredList[]>;
}

export class MemoryStore implements Store {
  rates = new Map<string, number>();
  async consumeRate(key: string, limit: number, _expiresAt: number) {
    void _expiresAt; // Window-specific keys never need to be reused by the local in-memory store.
    const count = this.rates.get(key) ?? 0;
    if (count >= limit) return false;
    this.rates.set(key, count + 1);
    return true;
  }
  uploads = new Map<string, UploadSession>();
  async putUpload(session: UploadSession) {
    this.uploads.set(session.key, session);
  }
  async claimUpload(key: string, tokenHash: string, now: number) {
    const session = this.uploads.get(key);
    if (!session || session.tokenHash !== tokenHash || session.expiresAt <= now) return false;
    this.uploads.delete(key);
    return true;
  }
  lists = new Map<string, StoredList>();
  teams = new Map<string, StoredTeam>();
  reports: StoredReport[] = [];

  async getList(id: string) {
    return structuredClone(this.lists.get(id) ?? null);
  }
  async putList(list: StoredList, expectVersion?: number) {
    const current = this.lists.get(list.id);
    if (current?.hidden) throw new VersionConflict(list.id);
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
    if (
      this.reports.some(
        (r) =>
          r.targetType === report.targetType &&
          r.targetId === report.targetId &&
          r.ipHash === report.ipHash &&
          r.status !== "resolved",
      )
    )
      return false;
    this.reports.push({ ...report, status: "open" });
    return true;
  }
  async reportCount(type: "list" | "team", id: string) {
    return new Set(
      this.reports
        .filter((r) => r.targetType === type && r.targetId === id && r.status !== "resolved")
        .map((r) => r.ipHash),
    ).size;
  }
  async hideList(id: string) {
    const list = this.lists.get(id);
    if (!list || list.hidden) return false;
    this.lists.set(id, { ...list, hidden: true, version: list.version + 1 });
    return true;
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

  async consumeRate(key: string, limit: number, expiresAt: number) {
    try {
      await this.db.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { PK: key, SK: "COUNT" },
          UpdateExpression: "SET expiresAt = :expires ADD #count :one",
          ConditionExpression: "attribute_not_exists(#count) OR #count < :limit",
          ExpressionAttributeNames: { "#count": "count" },
          ExpressionAttributeValues: { ":expires": expiresAt, ":one": 1, ":limit": limit },
        }),
      );
      return true;
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) return false;
      throw e;
    }
  }

  async putUpload(session: UploadSession) {
    await this.db.send(
      new PutCommand({
        TableName: this.table,
        Item: { PK: `UPLOAD#${session.key}`, SK: "META", ...session },
        ConditionExpression: "attribute_not_exists(PK)",
      }),
    );
  }
  async claimUpload(key: string, tokenHash: string, now: number) {
    try {
      await this.db.send(
        new DeleteCommand({
          TableName: this.table,
          Key: { PK: `UPLOAD#${key}`, SK: "META" },
          ConditionExpression: "tokenHash = :hash AND expiresAt > :now",
          ExpressionAttributeValues: { ":hash": tokenHash, ":now": now },
        }),
      );
      return true;
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) return false;
      throw e;
    }
  }

  async getList(id: string) {
    const r = await this.db.send(
      new GetCommand({
        TableName: this.table,
        Key: { PK: `LIST#${id}`, SK: "META" },
        ConsistentRead: true,
      }),
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
                ConditionExpression:
                  "version = :v AND (attribute_not_exists(#hidden) OR #hidden = :no)",
                ExpressionAttributeNames: { "#hidden": "hidden" },
                ExpressionAttributeValues: { ":v": expectVersion, ":no": false },
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
    try {
      await this.db.send(
        new PutCommand({
          TableName: this.table,
          Item: {
            PK: `REPORT#${report.targetType}#${report.targetId}`,
            SK: report.ipHash,
            ...report,
            status: "open",
            // Open reports share one GSI1 partition so moderators query instead of scanning (#51).
            GSI1PK: OPEN_REPORTS,
            GSI1SK: report.createdAt,
          },
          ConditionExpression: "attribute_not_exists(PK) OR #status = :resolved",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":resolved": "resolved" },
        }),
      );
      return true;
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) return false;
      throw e;
    }
  }
  async reportCount(type: "list" | "team", id: string) {
    let total = 0;
    let start: Record<string, unknown> | undefined;
    do {
      const result = await this.db.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: "PK = :pk",
          FilterExpression: "#status = :open",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":pk": `REPORT#${type}#${id}`, ":open": "open" },
          ConsistentRead: true,
          Select: "COUNT",
          ExclusiveStartKey: start,
        }),
      );
      total += result.Count ?? 0;
      start = result.LastEvaluatedKey;
    } while (start);
    return total;
  }
  async hideList(id: string) {
    try {
      await this.db.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { PK: `LIST#${id}`, SK: "META" },
          UpdateExpression: "SET #hidden = :yes, version = version + :one REMOVE GSI1PK, GSI1SK",
          ConditionExpression:
            "attribute_exists(PK) AND (attribute_not_exists(#hidden) OR #hidden = :no)",
          ExpressionAttributeNames: { "#hidden": "hidden" },
          ExpressionAttributeValues: { ":yes": true, ":no": false, ":one": 1 },
        }),
      );
      return true;
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) return false;
      throw e;
    }
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
    // A GSI is eventually consistent. Recheck candidates on the base table so a stale
    // index entry can never republish a hidden or newly unlisted list.
    const current: StoredList[] = [];
    for (let i = 0; i < out.length; i += 100) {
      let pending: NonNullable<BatchGetCommandInput["RequestItems"]> = {
        [this.table]: {
          Keys: out.slice(i, i + 100).map((l) => ({ PK: `LIST#${l.id}`, SK: "META" })),
          ConsistentRead: true,
        },
      };
      for (let attempt = 0; Object.keys(pending).length; attempt++) {
        if (attempt === 4) throw new Error("Browse verification was throttled");
        if (attempt) await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
        const response = await this.db.send(new BatchGetCommand({ RequestItems: pending }));
        current.push(
          ...(response.Responses?.[this.table] ?? []).map((item) => strip<StoredList>(item)),
        );
        pending = response.UnprocessedKeys ?? {};
      }
    }
    return current
      .filter((l) => l.visibility === "public" && !l.hidden)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

function strip<T>(item: Record<string, unknown>): T {
  const { PK: _pk, SK: _sk, GSI1PK: _gpk, GSI1SK: _gsk, ...rest } = item;
  return rest as T;
}
