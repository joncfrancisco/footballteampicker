import {
  S3Client,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import process from "node:process";
import {
  DynamoStore,
  OPEN_REPORTS,
  RESOLVED_REPORTS,
  type StoredList,
  type StoredReport,
  type StoredTeam,
} from "./store";
import { S3Publisher, CACHE, browseIndex, listView, type Publisher } from "./publish";

const TABLE = "footballteampicker";
const BUCKET = "footballteampicker-media-020949219706";
const DISTRIBUTION = "E374QW7TXASG40";
const SITE = "https://depthchart.joncfrancis.co";
const ARCHIVE = "private/takedown/";
/** The scoped role from #50. It may hide and dismiss, never restore. */
const MODERATOR_ROLE = ":assumed-role/footballteampicker-moderator/";
type Target = "list" | "team";
type ReportRow = StoredReport & { PK: string; SK: string };
type Dependencies = {
  db: DynamoDBDocumentClient;
  s3: S3Client;
  cloudfront: CloudFrontClient;
  publish: Publisher;
  catalog: () => Promise<StoredList[]>;
};
/** Who resolved the reports and why, recorded on every report item (#51). */
export type Resolution = { by: string; note?: string; at?: string };

async function queryAll(db: DynamoDBDocumentClient, input: QueryCommand["input"]) {
  const items: ReportRow[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const response = await db.send(new QueryCommand({ ...input, ExclusiveStartKey: cursor }));
    items.push(...((response.Items ?? []) as ReportRow[]));
    cursor = response.LastEvaluatedKey;
  } while (cursor);
  return items;
}

/** Open reports, oldest first, from the GSI1 open-reports partition. */
export async function moderationQueue(db: DynamoDBDocumentClient): Promise<ReportRow[]> {
  const items = await queryAll(db, {
    TableName: TABLE,
    IndexName: "GSI1",
    KeyConditionExpression: "GSI1PK = :open",
    ExpressionAttributeValues: { ":open": OPEN_REPORTS },
  });
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Resolutions since `since` (ISO), oldest first, for the daily digest and audits. */
export async function moderationLog(db: DynamoDBDocumentClient, since: string) {
  return queryAll(db, {
    TableName: TABLE,
    IndexName: "GSI1",
    KeyConditionExpression: "GSI1PK = :resolved AND GSI1SK >= :since",
    ExpressionAttributeValues: { ":resolved": RESOLVED_REPORTS, ":since": since },
  });
}

/** One target's open reports, read from the table so a just-filed report is included. */
async function openReports(db: DynamoDBDocumentClient, type: Target, id: string) {
  return queryAll(db, {
    TableName: TABLE,
    KeyConditionExpression: "PK = :pk",
    FilterExpression: "attribute_not_exists(#status) OR #status = :open",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: { ":pk": `REPORT#${type}#${id}`, ":open": "open" },
    ConsistentRead: true,
  });
}

async function resolveReports(
  db: DynamoDBDocumentClient,
  type: Target,
  id: string,
  action: NonNullable<StoredReport["action"]>,
  resolution: Resolution,
) {
  const at = resolution.at ?? new Date().toISOString();
  const reports = await openReports(db, type, id);
  for (const report of reports)
    await db.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: report.PK, SK: report.SK },
        UpdateExpression:
          "SET #status = :resolved, GSI1PK = :partition, GSI1SK = :at, resolvedAt = :at, resolvedBy = :by, #action = :action" +
          (resolution.note ? ", note = :note" : ""),
        ExpressionAttributeNames: { "#status": "status", "#action": "action" },
        ExpressionAttributeValues: {
          ":resolved": "resolved",
          ":partition": RESOLVED_REPORTS,
          ":at": at,
          ":by": resolution.by,
          ":action": action,
          ...(resolution.note ? { ":note": resolution.note } : {}),
        },
      }),
    );
  return reports.length;
}

async function keys(s3: S3Client, prefix: string) {
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const response = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: cursor }),
    );
    out.push(...(response.Contents ?? []).flatMap((o) => (o.Key ? [o.Key] : [])));
    cursor = response.NextContinuationToken;
  } while (cursor);
  return out;
}
const copySource = (key: string) => `${BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`;
const stripKeys = (item: Record<string, unknown>) => {
  const { PK: _pk, SK: _sk, GSI1PK: _gpk, GSI1SK: _gsk, ...rest } = item;
  return rest;
};
const savedId = (id: string) => /^[A-Za-z0-9]{10}$/.test(id);
const link = (type: Target, id: string) => `${SITE}/${type === "list" ? "l" : "t"}/${id}`;

async function getTarget(db: DynamoDBDocumentClient, type: Target, id: string) {
  const response = await db.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: `${type.toUpperCase()}#${id}`, SK: "META" },
      ConsistentRead: true,
    }),
  );
  return response.Item;
}

/**
 * Direct AWS operation, never a public route. Hiding resolves the target's open reports;
 * restoring is admin-only (the moderator role can't read the private recovery copies).
 * A dry run reads but writes nothing and returns what would change.
 */
export async function takedown(
  deps: Dependencies,
  type: Target,
  id: string,
  options: Resolution & { restore?: boolean; dryRun?: boolean },
) {
  const restore = options.restore ?? false;
  if (!savedId(id))
    throw new Error(
      "Expected a saved list/team ID. Bundled seeds require a code change and redeploy.",
    );
  const key = { PK: `${type.toUpperCase()}#${id}`, SK: "META" };
  const item = await getTarget(deps.db, type, id);
  if (!item) throw new Error("List/team not found");
  const source = stripKeys(item);
  const publicKey = `m/${type === "list" ? "l" : "t"}/${id}.json`;
  const imagePrefix = `m/img/${id}/`;
  if (options.dryRun)
    return {
      dryRun: true,
      action: restore ? "restore" : "takedown",
      type,
      id,
      title: source.title,
      alreadyHidden: source.hidden === true,
      publicJson: publicKey,
      images:
        type === "list"
          ? await keys(deps.s3, restore ? `${ARCHIVE}${imagePrefix}` : imagePrefix)
          : [],
      reportsResolved: (await openReports(deps.db, type, id)).length,
    };
  let reportsResolved = 0;
  try {
    if (!restore) {
      // Hide first; failed archival remains safe and can be retried without re-exposing content.
      await deps.db.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: key,
          UpdateExpression:
            type === "list"
              ? "SET #hidden = :hidden, version = version + :one REMOVE GSI1PK, GSI1SK"
              : "SET #hidden = :hidden",
          ExpressionAttributeNames: { "#hidden": "hidden" },
          ConditionExpression: "attribute_exists(PK)",
          ExpressionAttributeValues: { ":hidden": true, ...(type === "list" ? { ":one": 1 } : {}) },
        }),
      );
      await deps.publish.delete(publicKey);
      if (type === "list")
        for (const imageKey of await keys(deps.s3, imagePrefix)) {
          await deps.s3.send(
            new CopyObjectCommand({
              Bucket: BUCKET,
              Key: `${ARCHIVE}${imageKey}`,
              CopySource: copySource(imageKey),
            }),
          );
          await deps.s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: imageKey }));
        }
    } else {
      if (type === "list")
        for (const imageKey of await keys(deps.s3, `${ARCHIVE}${imagePrefix}`)) {
          const destination = imageKey.slice(ARCHIVE.length);
          await deps.s3.send(
            new CopyObjectCommand({
              Bucket: BUCKET,
              Key: destination,
              CopySource: copySource(imageKey),
            }),
          );
          // Keep the private recovery copy for a repeat takedown or interrupted restore.
        }
      const isPublic = type === "list" && source.visibility === "public";
      await deps.db.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: key,
          UpdateExpression:
            type === "list"
              ? `SET #hidden = :hidden, version = version + :one${isPublic ? ", GSI1PK = :public, GSI1SK = :created" : ""}`
              : "SET #hidden = :hidden",
          ExpressionAttributeNames: { "#hidden": "hidden" },
          ConditionExpression: "attribute_exists(PK)",
          ExpressionAttributeValues: {
            ":hidden": false,
            ...(type === "list" ? { ":one": 1 } : {}),
            ...(isPublic ? { ":public": "PUBLIC", ":created": source.createdAt } : {}),
          },
        }),
      );
      if (type === "list")
        await deps.publish.put(
          publicKey,
          listView({ ...source, hidden: false, version: Number(source.version) + 1 } as StoredList),
          CACHE.list,
        );
      else {
        const { hidden: _hidden, ...team } = source;
        await deps.publish.put(publicKey, team, CACHE.team);
      }
    }

    if (type === "list") {
      const lists = (await deps.catalog()).filter((l) => l.id !== id);
      if (restore && source.visibility === "public")
        lists.push({ ...source, hidden: false, version: Number(source.version) + 1 } as StoredList);
      lists.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      await deps.publish.put(
        "m/browse/index.json",
        browseIndex(lists, new Date().toISOString()),
        CACHE.browse,
      );
    }
    // Last, so a failed takedown stays in the queue to be retried.
    reportsResolved = await resolveReports(
      deps.db,
      type,
      id,
      restore ? "restore" : "takedown",
      options,
    );
  } finally {
    const paths = [`/m/l/${id}.json`, `/m/t/${id}.json`, `/m/img/${id}/*`, "/m/browse/index.json"];
    await deps.cloudfront.send(
      new CreateInvalidationCommand({
        DistributionId: DISTRIBUTION,
        InvalidationBatch: {
          CallerReference: randomUUID(),
          Paths: { Items: paths, Quantity: paths.length },
        },
      }),
    );
  }
  return { action: restore ? "restore" : "takedown", type, id, reportsResolved };
}

/** Resolve a target's open reports without changing what's published. */
export async function dismiss(
  db: DynamoDBDocumentClient,
  type: Target,
  id: string,
  options: Resolution & { dryRun?: boolean },
) {
  if (!options.note?.trim()) throw new Error("A dismissal needs --note saying why");
  if (options.dryRun)
    return {
      dryRun: true,
      action: "dismiss",
      type,
      id,
      reportsResolved: (await openReports(db, type, id)).length,
    };
  return {
    action: "dismiss",
    type,
    id,
    reportsResolved: await resolveReports(db, type, id, "dismiss", options),
  };
}

/** The open queue grouped by target, with what a moderator needs to decide (#51). */
export async function queueDetails(db: DynamoDBDocumentClient) {
  const groups = new Map<string, ReportRow[]>();
  for (const row of await moderationQueue(db)) {
    const k = `${row.targetType}#${row.targetId}`;
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }
  const out = [];
  for (const rows of groups.values()) {
    const { targetType: type, targetId: id } = rows[0]!;
    const seed = !savedId(id);
    const item = seed ? undefined : await getTarget(db, type, id);
    const base = {
      type,
      id,
      link: link(type, id),
      seed,
      reports: rows.length,
      oldestReportAt: rows[0]!.createdAt,
      reasons: rows
        .map((r) => ({ reason: r.reason, createdAt: r.createdAt }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      missing: !seed && !item,
      hidden: item?.hidden === true,
    };
    if (item && type === "list") {
      const list = item as StoredList;
      out.push({
        ...base,
        list: {
          title: list.title,
          ip: list.ip,
          description: list.description,
          tags: list.tags,
          visibility: list.visibility,
          characters: list.characters.map((c) => c.name),
          atlas: `${SITE}/${list.atlas.key}`,
        },
      });
    } else if (item) {
      const team = item as StoredTeam;
      out.push({
        ...base,
        team: {
          title: team.title,
          listId: team.listId,
          listTitle: team.listTitle,
          characters: Object.values(team.characters).map((c) => c.name),
          atlas: `${SITE}${team.atlas.src}`,
        },
      });
    } else out.push(base);
  }
  return out;
}

/** One-off admin backfill: put reports filed before #51 into their GSI1 partitions. */
export async function reindexReports(db: DynamoDBDocumentClient) {
  let updated = 0;
  let cursor: Record<string, unknown> | undefined;
  do {
    const response = await db.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: "begins_with(PK, :prefix) AND attribute_not_exists(GSI1PK)",
        ExpressionAttributeValues: { ":prefix": "REPORT#" },
        ExclusiveStartKey: cursor,
      }),
    );
    for (const row of (response.Items ?? []) as ReportRow[]) {
      const open = row.status !== "resolved";
      await db.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { PK: row.PK, SK: row.SK },
          UpdateExpression: "SET GSI1PK = :partition, GSI1SK = :at",
          ExpressionAttributeValues: {
            ":partition": open ? OPEN_REPORTS : RESOLVED_REPORTS,
            ":at": open ? row.createdAt : (row.resolvedAt ?? row.createdAt),
          },
        }),
      );
      updated++;
    }
    cursor = response.LastEvaluatedKey;
  } while (cursor);
  return updated;
}

/** `24h`, `7d` or an ISO timestamp, as an ISO lower bound. */
export function since(value: string, now = Date.now()) {
  const relative = /^(\d+)([hd])$/.exec(value);
  if (relative) {
    const hours = Number(relative[1]) * (relative[2] === "d" ? 24 : 1);
    return new Date(now - hours * 3_600_000).toISOString();
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid --since ${value}`);
  return date.toISOString();
}

const USAGE = `Usage:
  bin/moderation queue [--json]
  bin/moderation takedown <list|team> <id> [--note "<why>"] [--dry-run]
  bin/moderation dismiss <list|team> <id> --note "<why>" [--dry-run]
  bin/moderation restore <list|team> <id> [--note "<why>"] [--dry-run]    (admin only)
  bin/moderation log [--since 24h|7d|<ISO>] [--json]
  bin/moderation reindex                                                  (admin only, once)
  bin/takedown <list|team> <id> [--restore] [--note "<why>"] [--dry-run]`;

export async function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
      note: { type: "string" },
      "dry-run": { type: "boolean" },
      restore: { type: "boolean" },
      since: { type: "string" },
    },
  });
  // bin/takedown <list|team> <id> [--restore] keeps working.
  let [command, ...rest] = positionals;
  if (command === "list" || command === "team") {
    rest = [command, ...rest];
    command = values.restore ? "restore" : "takedown";
  } else if (values.restore) throw new Error(USAGE);
  const [type, id] = rest;
  const targeted = ["takedown", "dismiss", "restore"].includes(command ?? "");
  if (
    !command ||
    !["queue", "log", "reindex", ...(targeted ? [command] : [])].includes(command) ||
    (targeted && ((type !== "list" && type !== "team") || !id || rest.length > 2)) ||
    (!targeted && rest.length > 0)
  )
    throw new Error(USAGE);

  const config = { region: "us-east-1" };
  const identity = await new STSClient(config).send(new GetCallerIdentityCommand({}));
  if (identity.Account !== "020949219706") throw new Error("Expected AWS account 020949219706");
  const by = identity.Arn ?? "unknown";
  if ((command === "restore" || command === "reindex") && by.includes(MODERATOR_ROLE))
    throw new Error(`${command} is admin-only; the moderator role can't run it`);
  const client = new DynamoDBClient(config);
  const db = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
  const print = (value: unknown) => console.log(JSON.stringify(value));

  if (command === "queue") {
    if (values.json) return print(await queueDetails(db));
    for (const row of await moderationQueue(db))
      print({
        type: row.targetType,
        id: row.targetId,
        reason: row.reason,
        createdAt: row.createdAt,
      });
    return;
  }
  if (command === "log") {
    for (const row of await moderationLog(db, since(values.since ?? "24h")))
      print({
        type: row.targetType,
        id: row.targetId,
        action: row.action,
        resolvedBy: row.resolvedBy,
        resolvedAt: row.resolvedAt,
        note: row.note,
        reason: row.reason,
      });
    return;
  }
  if (command === "reindex") return print({ reindexed: await reindexReports(db) });

  const resolution = { by, note: values.note, dryRun: values["dry-run"] };
  if (command === "dismiss") return print(await dismiss(db, type as Target, id!, resolution));
  const s3 = new S3Client(config);
  const store = new DynamoStore(TABLE, client);
  const result = await takedown(
    {
      db,
      s3,
      cloudfront: new CloudFrontClient(config),
      publish: new S3Publisher(BUCKET, s3),
      catalog: () => store.publicLists(),
    },
    type as Target,
    id!,
    { ...resolution, restore: command === "restore" },
  );
  if (values.json || values["dry-run"]) return print(result);
  console.log(
    `${command === "restore" ? "Restored" : "Hidden"} ${type} ${id}; resolved ${result.reportsResolved} report(s); CloudFront invalidation requested.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
