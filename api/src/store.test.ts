import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  BatchGetCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { DynamoStore, VersionConflict, type StoredList } from "./store";

const ddb = mockClient(DynamoDBDocumentClient);
beforeEach(() => ddb.reset());

const list = {
  id: "abc",
  title: "T",
  ip: "I",
  description: "",
  tags: [],
  visibility: "public",
  atlas: { key: "m/a/x.webp", tile: 120, columns: 4, count: 1 },
  characters: [],
  editTokenHash: "h",
  version: 1,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
} as unknown as StoredList;

describe("DynamoStore (single-table keys)", () => {
  const store = new DynamoStore("t", new DynamoDBClient({ region: "us-east-1" }));

  it("writes lists under LIST#<id>/META, indexes public ones in GSI1, guards versions", async () => {
    ddb.on(PutCommand).resolves({});
    await store.putList(list);
    await store.putList({ ...list, visibility: "unlisted", version: 2 }, 1);
    const [create, update] = ddb.commandCalls(PutCommand).map((c) => c.args[0].input);
    expect(create).toMatchObject({
      Item: { PK: "LIST#abc", SK: "META", GSI1PK: "PUBLIC", GSI1SK: list.createdAt },
      ConditionExpression: "attribute_not_exists(PK)",
    });
    expect(update!.Item).not.toHaveProperty("GSI1PK");
    expect(update).toMatchObject({
      ConditionExpression: "version = :v AND (attribute_not_exists(#hidden) OR #hidden = :no)",
      ExpressionAttributeNames: { "#hidden": "hidden" },
      ExpressionAttributeValues: { ":v": 1, ":no": false },
    });
  });

  it("turns a failed condition into a VersionConflict", async () => {
    ddb
      .on(PutCommand)
      .rejects(new ConditionalCheckFailedException({ message: "x", $metadata: {} }));
    await expect(store.putList(list)).rejects.toBeInstanceOf(VersionConflict);
  });

  it("atomically consumes an unexpired upload token and treats a failed condition as rejection", async () => {
    ddb.on(DeleteCommand).resolves({});
    expect(await store.claimUpload("tmp/key", "hashed-token", 100)).toBe(true);
    expect(ddb.commandCalls(DeleteCommand)[0]!.args[0].input).toMatchObject({
      Key: { PK: "UPLOAD#tmp/key", SK: "META" },
      ConditionExpression: "tokenHash = :hash AND expiresAt > :now",
      ExpressionAttributeValues: { ":hash": "hashed-token", ":now": 100 },
    });
    ddb
      .on(DeleteCommand)
      .rejects(new ConditionalCheckFailedException({ message: "expired", $metadata: {} }));
    expect(await store.claimUpload("tmp/key", "wrong", 100)).toBe(false);
  });

  it("strips keys on read and pages the public index newest first", async () => {
    ddb
      .on(GetCommand)
      .resolves({ Item: { PK: "LIST#abc", SK: "META", GSI1PK: "PUBLIC", GSI1SK: "x", ...list } });
    expect(await store.getList("abc")).toEqual(list);
    ddb
      .on(QueryCommand)
      .resolvesOnce({
        Items: [{ PK: "LIST#1", SK: "META", ...list, id: "1" }],
        LastEvaluatedKey: { k: 1 },
      })
      .resolvesOnce({ Items: [{ PK: "LIST#2", SK: "META", ...list, id: "2" }] });
    ddb.on(BatchGetCommand).resolves({
      Responses: {
        t: [
          { ...list, id: "1" },
          { ...list, id: "2" },
        ],
      },
    });
    expect((await store.publicLists()).map((l) => l.id)).toEqual(["1", "2"]);
    expect(ddb.commandCalls(QueryCommand)[0]!.args[0].input).toMatchObject({
      IndexName: "GSI1",
      ScanIndexForward: false,
    });
  });

  it("filters stale hidden GSI entries using consistent base-table reads", async () => {
    ddb.on(QueryCommand).resolves({
      Items: [
        { ...list, id: "visible" },
        { ...list, id: "hidden" },
      ],
    });
    ddb.on(BatchGetCommand).resolves({
      Responses: {
        t: [
          { ...list, id: "visible" },
          { ...list, id: "hidden", hidden: true },
        ],
      },
    });
    expect((await store.publicLists()).map((l) => l.id)).toEqual(["visible"]);
    expect(
      ddb.commandCalls(BatchGetCommand)[0]!.args[0].input.RequestItems?.t?.ConsistentRead,
    ).toBe(true);
  });
});
