import {
  S3Client,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import {
  dismiss,
  main,
  moderationLog,
  moderationQueue,
  queueDetails,
  reindexReports,
  since,
  takedown,
} from "./moderation";
import { reportNotifier } from "./notifications";
import { MemoryPublisher } from "./publish";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
const s3 = new S3Client({ region: "us-east-1" });
const cf = new CloudFrontClient({ region: "us-east-1" });
const ddb = mockClient(db),
  objects = mockClient(s3),
  cdn = mockClient(cf);
const id = "abcdefghij";
const by = {
  by: "arn:aws:sts::020949219706:assumed-role/footballteampicker-moderator/agent",
  note: "Rule 2: harassment",
};
const image = `m/img/${id}/atlas-hash.webp`;
const source = {
  PK: `LIST#${id}`,
  SK: "META",
  id,
  version: 1,
  title: "Reported list",
  ip: "Game",
  visibility: "public",
  editTokenHash: "private-edit-hash",
  description: "",
  tags: [],
  characters: [],
  atlas: { key: image, tile: 128, columns: 16, count: 11 },
  createdAt: "2026-10-31",
  updatedAt: "2026-10-31",
};
beforeEach(() => {
  ddb.reset();
  objects.reset();
  cdn.reset();
  ddb.on(GetCommand).resolves({ Item: source });
  ddb.on(UpdateCommand).resolves({});
  ddb.on(QueryCommand).resolves({ Items: [] });
  ddb.on(ScanCommand).resolves({ Items: [] });
  objects.on(ListObjectsV2Command).resolves({ Contents: [] });
  objects.on(CopyObjectCommand).resolves({});
  objects.on(DeleteObjectCommand).resolves({});
  cdn.on(CreateInvalidationCommand).resolves({});
});
describe("moderator operations", () => {
  it("hides before archiving, keeps recovery copies private, and invalidates published paths", async () => {
    const publish = new MemoryPublisher();
    await publish.put(`m/l/${id}.json`, {}, "");
    objects.on(ListObjectsV2Command).resolves({ Contents: [{ Key: image }] });
    await takedown({ db, s3, cloudfront: cf, publish, catalog: async () => [] }, "list", id, by);
    expect(publish.json(`m/l/${id}.json`)).toBeUndefined();
    expect(objects.commandCalls(CopyObjectCommand)[0]!.args[0].input).toMatchObject({
      Key: `private/takedown/${image}`,
      CopySource: `footballteampicker-media-020949219706/${image}`,
    });
    expect(objects.commandCalls(DeleteObjectCommand)[0]!.args[0].input.Key).toBe(image);
    expect(
      ddb.commandCalls(UpdateCommand)[0]!.args[0].input.ExpressionAttributeValues,
    ).toMatchObject({ ":hidden": true });
    expect(
      cdn.commandCalls(CreateInvalidationCommand)[0]!.args[0].input.InvalidationBatch?.Paths?.Items,
    ).toContain(`/m/img/${id}/*`);
  });
  it("restores archived portraits and sanitized JSON, and resolves existing reports", async () => {
    const publish = new MemoryPublisher();
    ddb.on(GetCommand).resolves({ Item: { ...source, hidden: true, version: 2 } });
    ddb.on(QueryCommand).resolves({
      Items: [
        {
          PK: `REPORT#list#${id}`,
          SK: "hashed-network",
          targetId: id,
          targetType: "list",
          createdAt: "2026-10-31",
          reason: "spam",
        },
      ],
    });
    objects.on(ListObjectsV2Command).resolves({ Contents: [{ Key: `private/takedown/${image}` }] });
    await takedown({ db, s3, cloudfront: cf, publish, catalog: async () => [] }, "list", id, {
      ...by,
      restore: true,
    });
    expect(objects.commandCalls(CopyObjectCommand)[0]!.args[0].input.Key).toBe(image);
    expect(publish.json(`m/l/${id}.json`)).toMatchObject({
      version: 3,
      atlas: { src: `/${image}` },
    });
    expect(publish.json(`m/l/${id}.json`)).not.toHaveProperty("editTokenHash");
    expect(publish.json(`m/l/${id}.json`)).not.toHaveProperty("hidden");
    expect(publish.json("m/browse/index.json")).toMatchObject({ lists: [{ id }] });
    const resolved = ddb
      .commandCalls(UpdateCommand)
      .map((c) => c.args[0].input)
      .find((i) => i.Key?.PK === `REPORT#list#${id}`);
    expect(resolved?.ExpressionAttributeValues).toMatchObject({
      ":resolved": "resolved",
      ":partition": "REPORT#resolved",
      ":action": "restore",
      ":by": by.by,
    });
  });
  it("keeps the public JSON deleted and invalidates even if image archival fails", async () => {
    const publish = new MemoryPublisher();
    await publish.put(`m/l/${id}.json`, {}, "");
    objects.on(ListObjectsV2Command).resolves({ Contents: [{ Key: image }] });
    objects.on(CopyObjectCommand).rejects(new Error("storage unavailable"));
    await expect(
      takedown({ db, s3, cloudfront: cf, publish, catalog: async () => [] }, "list", id, by),
    ).rejects.toThrow("storage unavailable");
    expect(publish.json(`m/l/${id}.json`)).toBeUndefined();
    expect(cdn.commandCalls(CreateInvalidationCommand)).toHaveLength(1);
    expect(objects.commandCalls(DeleteObjectCommand)).toHaveLength(0);
  });
  it("pages through open reports from the GSI1 partition, not a table scan", async () => {
    ddb
      .on(QueryCommand)
      .resolvesOnce({
        Items: [{ targetId: "first", createdAt: "2026-10-30" }],
        LastEvaluatedKey: { PK: "cursor", SK: "cursor" },
      })
      .resolvesOnce({ Items: [{ targetId: "second", createdAt: "2026-10-31" }] });
    expect((await moderationQueue(db)).map((r) => r.targetId)).toEqual(["first", "second"]);
    expect(ddb.commandCalls(QueryCommand)[0]!.args[0].input).toMatchObject({
      IndexName: "GSI1",
      ExpressionAttributeValues: { ":open": "REPORT#open" },
    });
    expect(ddb.commandCalls(ScanCommand)).toHaveLength(0);
  });
  it("notifies the configured topic with the reported item link", async () => {
    const sns = new SNSClient({ region: "us-east-1" });
    const notifications = mockClient(sns);
    notifications.on(PublishCommand).resolves({});
    await reportNotifier(
      "topic",
      "depthchart.joncfrancis.co",
      sns,
    )({ targetId: id, targetType: "list", reason: "Prohibited image" });
    expect(notifications.commandCalls(PublishCommand)[0]!.args[0].input).toMatchObject({
      TopicArn: "topic",
      Subject: "Depth Chart content report",
      Message: expect.stringContaining(`https://depthchart.joncfrancis.co/l/${id}`),
    });
    notifications.restore();
  });
});

const report = (over: Record<string, unknown> = {}) => ({
  PK: `REPORT#list#${id}`,
  SK: "hashed-network",
  ipHash: "hashed-network",
  targetId: id,
  targetType: "list",
  status: "open",
  createdAt: "2026-10-30T10:00:00.000Z",
  reason: "harassment in the description",
  ...over,
});
const deps = (publish = new MemoryPublisher()) => ({
  db,
  s3,
  cloudfront: cf,
  publish,
  catalog: async () => [],
});
const reportUpdates = () =>
  ddb
    .commandCalls(UpdateCommand)
    .map((c) => c.args[0].input)
    .filter((i) => String(i.Key?.PK).startsWith("REPORT#"));

describe("moderation for the scoped role (#51)", () => {
  it("resolves the target's open reports with an audit trail after a takedown", async () => {
    ddb.on(QueryCommand).resolves({ Items: [report(), report({ SK: "other-network" })] });
    const result = await takedown(deps(), "list", id, by);
    expect(result).toMatchObject({ action: "takedown", reportsResolved: 2 });
    expect(reportUpdates()).toHaveLength(2);
    expect(reportUpdates()[0]!.ExpressionAttributeValues).toMatchObject({
      ":resolved": "resolved",
      ":partition": "REPORT#resolved",
      ":action": "takedown",
      ":by": by.by,
      ":note": by.note,
    });
  });
  it("leaves reports open when the takedown fails part way", async () => {
    ddb.on(QueryCommand).resolves({ Items: [report()] });
    objects.on(ListObjectsV2Command).resolves({ Contents: [{ Key: image }] });
    objects.on(CopyObjectCommand).rejects(new Error("storage unavailable"));
    await expect(takedown(deps(), "list", id, by)).rejects.toThrow("storage unavailable");
    expect(reportUpdates()).toHaveLength(0);
  });
  it("plans a takedown in a dry run without writing or invalidating", async () => {
    const publish = new MemoryPublisher();
    await publish.put(`m/l/${id}.json`, {}, "");
    ddb.on(QueryCommand).resolves({ Items: [report()] });
    objects.on(ListObjectsV2Command).resolves({ Contents: [{ Key: image }] });
    const plan = await takedown(deps(publish), "list", id, { ...by, dryRun: true });
    expect(plan).toMatchObject({
      dryRun: true,
      action: "takedown",
      title: "Reported list",
      images: [image],
      reportsResolved: 1,
    });
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
    expect(objects.commandCalls(CopyObjectCommand)).toHaveLength(0);
    expect(cdn.commandCalls(CreateInvalidationCommand)).toHaveLength(0);
    expect(publish.json(`m/l/${id}.json`)).toEqual({});
  });
  it("refuses seed ids", async () => {
    await expect(takedown(deps(), "list", "demo-lol", by)).rejects.toThrow("Bundled seeds");
  });
  it("dismisses with a required note and leaves published content alone", async () => {
    ddb.on(QueryCommand).resolves({ Items: [report()] });
    await expect(dismiss(db, "list", id, { by: by.by })).rejects.toThrow("--note");
    expect(await dismiss(db, "list", id, { ...by, dryRun: true })).toMatchObject({
      dryRun: true,
      reportsResolved: 1,
    });
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
    expect(await dismiss(db, "list", id, by)).toMatchObject({
      action: "dismiss",
      reportsResolved: 1,
    });
    expect(reportUpdates()[0]!.ExpressionAttributeValues).toMatchObject({ ":action": "dismiss" });
    expect(objects.commandCalls(DeleteObjectCommand)).toHaveLength(0);
    expect(cdn.commandCalls(CreateInvalidationCommand)).toHaveLength(0);
  });
  it("groups the queue by target with what a decision needs, and no secrets", async () => {
    ddb.on(QueryCommand).resolves({
      Items: [
        report(),
        report({ SK: "n2", ipHash: "n2", createdAt: "2026-10-31T10:00:00.000Z", reason: "spam" }),
        report({ PK: "REPORT#list#demo-lol", targetId: "demo-lol" }),
      ],
    });
    const queue = await queueDetails(db);
    expect(queue).toHaveLength(2);
    expect(queue[0]).toMatchObject({
      type: "list",
      id,
      link: `https://depthchart.joncfrancis.co/l/${id}`,
      seed: false,
      reports: 2,
      oldestReportAt: "2026-10-30T10:00:00.000Z",
      reasons: [{ reason: "spam" }, { reason: "harassment in the description" }],
      list: { title: "Reported list", atlas: `https://depthchart.joncfrancis.co/${image}` },
    });
    expect(queue[1]).toMatchObject({ id: "demo-lol", seed: true });
    const text = JSON.stringify(queue);
    for (const secret of ["private-edit-hash", "hashed-network", "n2"])
      expect(text).not.toContain(secret);
  });
  it("reads the log from the resolved partition", async () => {
    await moderationLog(db, "2026-10-30T00:00:00.000Z");
    expect(ddb.commandCalls(QueryCommand)[0]!.args[0].input).toMatchObject({
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :resolved AND GSI1SK >= :since",
      ExpressionAttributeValues: {
        ":resolved": "REPORT#resolved",
        ":since": "2026-10-30T00:00:00.000Z",
      },
    });
  });
  it("parses --since", () => {
    const now = Date.parse("2026-10-31T12:00:00.000Z");
    expect(since("24h", now)).toBe("2026-10-30T12:00:00.000Z");
    expect(since("7d", now)).toBe("2026-10-24T12:00:00.000Z");
    expect(since("2026-10-01", now)).toBe("2026-10-01T00:00:00.000Z");
    expect(() => since("soon", now)).toThrow("Invalid --since");
  });
  it("backfills reports filed before the index", async () => {
    ddb.on(ScanCommand).resolves({
      Items: [report(), report({ SK: "n2", status: "resolved", resolvedAt: "2026-10-31" })],
    });
    expect(await reindexReports(db)).toBe(2);
    expect(
      ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input.ExpressionAttributeValues),
    ).toEqual([
      { ":partition": "REPORT#open", ":at": "2026-10-30T10:00:00.000Z" },
      { ":partition": "REPORT#resolved", ":at": "2026-10-31" },
    ]);
  });
  it("refuses restore and reindex as the moderator role before touching data", async () => {
    const sts = mockClient(STSClient);
    sts.on(GetCallerIdentityCommand).resolves({ Account: "020949219706", Arn: by.by });
    await expect(main(["restore", "list", id])).rejects.toThrow("admin-only");
    await expect(main(["list", id, "--restore"])).rejects.toThrow("admin-only");
    await expect(main(["reindex"])).rejects.toThrow("admin-only");
    sts.restore();
  });
  it("rejects malformed commands", async () => {
    await expect(main(["takedown", "list"])).rejects.toThrow("Usage");
    await expect(main(["queue", "extra"])).rejects.toThrow("Usage");
    await expect(main(["dismiss", "list", id, "--restore"])).rejects.toThrow("Usage");
  });
});
