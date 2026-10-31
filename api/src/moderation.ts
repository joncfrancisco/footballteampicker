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
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import process from "node:process";
import { DynamoStore, type StoredList, type StoredReport } from "./store";
import { S3Publisher, CACHE, browseIndex, listView, type Publisher } from "./publish";

const TABLE = "footballteampicker";
const BUCKET = "footballteampicker-media-020949219706";
const DISTRIBUTION = "E374QW7TXASG40";
const ARCHIVE = "private/takedown/";
type ReportRow = StoredReport & { PK: string; SK: string };
type Dependencies = {
  db: DynamoDBDocumentClient;
  s3: S3Client;
  cloudfront: CloudFrontClient;
  publish: Publisher;
  catalog: () => Promise<StoredList[]>;
};

export async function moderationQueue(db: DynamoDBDocumentClient): Promise<ReportRow[]> {
  const items: ReportRow[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const response = await db.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression:
          "begins_with(PK, :prefix) AND (attribute_not_exists(#status) OR #status = :open)",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":prefix": "REPORT#", ":open": "open" },
        ExclusiveStartKey: cursor,
        ConsistentRead: true,
      }),
    );
    items.push(...((response.Items ?? []) as ReportRow[]));
    cursor = response.LastEvaluatedKey;
  } while (cursor);
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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

/** Admin-only direct AWS operation. Public routes never expose quarantine or restore actions. */
export async function takedown(
  deps: Dependencies,
  type: "list" | "team",
  id: string,
  restore = false,
) {
  if (!/^[A-Za-z0-9]{10}$/.test(id))
    throw new Error(
      "Expected a saved list/team ID. Bundled seeds require a code change and redeploy.",
    );
  const key = { PK: `${type.toUpperCase()}#${id}`, SK: "META" };
  const response = await deps.db.send(
    new GetCommand({ TableName: TABLE, Key: key, ConsistentRead: true }),
  );
  if (!response.Item) throw new Error("List/team not found");
  const source = stripKeys(response.Item);
  const publicKey = `m/${type === "list" ? "l" : "t"}/${id}.json`;
  const imagePrefix = `m/img/${id}/`;
  try {
    if (!restore) {
      // Hide first; failed archival remains safe and can be retried without re-exposing content.
      await deps.db.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: key,
          UpdateExpression:
            type === "list"
              ? "SET hidden = :hidden, version = version + :one REMOVE GSI1PK, GSI1SK"
              : "SET hidden = :hidden",
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
      for (const report of await moderationQueue(deps.db))
        if (report.targetType === type && report.targetId === id) {
          await deps.db.send(
            new UpdateCommand({
              TableName: TABLE,
              Key: { PK: report.PK, SK: report.SK },
              UpdateExpression: "SET #status = :resolved",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: { ":resolved": "resolved" },
            }),
          );
        }
      const isPublic = type === "list" && source.visibility === "public";
      await deps.db.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: key,
          UpdateExpression:
            type === "list"
              ? `SET hidden = :hidden, version = version + :one${isPublic ? ", GSI1PK = :public, GSI1SK = :created" : ""}`
              : "SET hidden = :hidden",
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
}

export async function main(args = process.argv.slice(2)) {
  const [type, id, flag] = args;
  if (
    type !== "queue" &&
    ((type !== "list" && type !== "team") ||
      !id ||
      (flag !== undefined && flag !== "--restore") ||
      args.length > 3)
  )
    throw new Error("Usage: bin/takedown <list|team> <id> [--restore]");
  const config = { region: "us-east-1" };
  const identity = await new STSClient(config).send(new GetCallerIdentityCommand({}));
  if (identity.Account !== "020949219706") throw new Error("Expected AWS account 020949219706");
  const client = new DynamoDBClient(config);
  const db = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
  if (args[0] === "queue") {
    const rows = await moderationQueue(db);
    for (const row of rows)
      console.log(
        JSON.stringify({
          type: row.targetType,
          id: row.targetId,
          reason: row.reason,
          createdAt: row.createdAt,
        }),
      );
    return;
  }
  if (
    (type !== "list" && type !== "team") ||
    !id ||
    (flag !== undefined && flag !== "--restore") ||
    args.length > 3
  )
    throw new Error("Usage: bin/takedown <list|team> <id> [--restore]");
  const s3 = new S3Client(config);
  const store = new DynamoStore(TABLE, client);
  await takedown(
    {
      db,
      s3,
      cloudfront: new CloudFrontClient(config),
      publish: new S3Publisher(BUCKET, s3),
      catalog: () => store.publicLists(),
    },
    type,
    id,
    flag === "--restore",
  );
  console.log(
    `${flag === "--restore" ? "Restored" : "Hidden"} ${type} ${id}; CloudFront invalidation requested.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
