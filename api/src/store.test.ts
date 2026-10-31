import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
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
      ConditionExpression: "version = :v",
      ExpressionAttributeValues: { ":v": 1 },
    });
  });

  it("turns a failed condition into a VersionConflict", async () => {
    ddb
      .on(PutCommand)
      .rejects(new ConditionalCheckFailedException({ message: "x", $metadata: {} }));
    await expect(store.putList(list)).rejects.toBeInstanceOf(VersionConflict);
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
    expect((await store.publicLists()).map((l) => l.id)).toEqual(["1", "2"]);
    expect(ddb.commandCalls(QueryCommand)[0]!.args[0].input).toMatchObject({
      IndexName: "GSI1",
      ScanIndexForward: false,
    });
  });
});
