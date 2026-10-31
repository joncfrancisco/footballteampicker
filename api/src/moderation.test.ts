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
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { moderationQueue, takedown } from "./moderation";
import { reportNotifier } from "./notifications";
import { MemoryPublisher } from "./publish";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
const s3 = new S3Client({ region: "us-east-1" });
const cf = new CloudFrontClient({ region: "us-east-1" });
const ddb = mockClient(db),
  objects = mockClient(s3),
  cdn = mockClient(cf);
const id = "abcdefghij";
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
    await takedown({ db, s3, cloudfront: cf, publish, catalog: async () => [] }, "list", id);
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
    ddb.on(ScanCommand).resolves({
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
    await takedown({ db, s3, cloudfront: cf, publish, catalog: async () => [] }, "list", id, true);
    expect(objects.commandCalls(CopyObjectCommand)[0]!.args[0].input.Key).toBe(image);
    expect(publish.json(`m/l/${id}.json`)).toMatchObject({
      version: 3,
      atlas: { src: `/${image}` },
    });
    expect(publish.json(`m/l/${id}.json`)).not.toHaveProperty("editTokenHash");
    expect(publish.json(`m/l/${id}.json`)).not.toHaveProperty("hidden");
    expect(publish.json("m/browse/index.json")).toMatchObject({ lists: [{ id }] });
    expect(ddb.commandCalls(UpdateCommand)[0]!.args[0].input.ExpressionAttributeValues).toEqual({
      ":resolved": "resolved",
    });
  });
  it("keeps the public JSON deleted and invalidates even if image archival fails", async () => {
    const publish = new MemoryPublisher();
    await publish.put(`m/l/${id}.json`, {}, "");
    objects.on(ListObjectsV2Command).resolves({ Contents: [{ Key: image }] });
    objects.on(CopyObjectCommand).rejects(new Error("storage unavailable"));
    await expect(
      takedown({ db, s3, cloudfront: cf, publish, catalog: async () => [] }, "list", id),
    ).rejects.toThrow("storage unavailable");
    expect(publish.json(`m/l/${id}.json`)).toBeUndefined();
    expect(cdn.commandCalls(CreateInvalidationCommand)).toHaveLength(1);
    expect(objects.commandCalls(DeleteObjectCommand)).toHaveLength(0);
  });
  it("pages through open reports", async () => {
    ddb
      .on(ScanCommand)
      .resolvesOnce({
        Items: [{ targetId: "first", createdAt: "2026-10-30" }],
        LastEvaluatedKey: { PK: "cursor", SK: "cursor" },
      })
      .resolvesOnce({ Items: [{ targetId: "second", createdAt: "2026-10-31" }] });
    expect((await moderationQueue(db)).map((r) => r.targetId)).toEqual(["first", "second"]);
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
