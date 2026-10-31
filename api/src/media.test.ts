import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { Media, MemoryMedia, S3Media, InvalidUpload, MAX_ATLAS, imageSize } from "./media";
import { MemoryStore } from "./store";
import lol from "../../seed/league-of-legends/list.json";

function jpeg(width: number, height: number) {
  const bytes = Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 0, 0, 0, 1, 1, 0x11, 0, 0xff, 0xd9,
  ]);
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  return bytes;
}
describe("atlas validation and sessions", () => {
  it("parses actual seed WebP dimensions and rejects wrong MIME, truncated and animated files", async () => {
    const bytes = await readFile(
      new URL(`../../seed/league-of-legends/${lol.atlas.src}`, import.meta.url),
    );
    expect(imageSize(bytes, "image/webp")).toEqual({
      width: lol.atlas.tile * lol.atlas.columns,
      height: lol.atlas.tile * Math.ceil(lol.atlas.count / lol.atlas.columns),
    });
    expect(() => imageSize(bytes, "image/jpeg")).toThrow(InvalidUpload);
    expect(() => imageSize(bytes.subarray(0, 20), "image/webp")).toThrow(InvalidUpload);
    expect(imageSize(jpeg(2048, 128), "image/jpeg")).toEqual({ width: 2048, height: 128 });
    const animated = Buffer.alloc(30);
    animated.write("RIFF");
    animated.writeUInt32LE(22, 4);
    animated.write("WEBPVP8X", 8);
    animated.writeUInt32LE(10, 16);
    animated[20] = 2;
    expect(() => imageSize(animated, "image/webp")).toThrow(InvalidUpload);
  });
  it("requires the session token, validates bytes, publishes an immutable per-list key, and prevents replay", async () => {
    const store = new MemoryStore();
    const objects = new MemoryMedia();
    const media = new Media(store, objects, () => 100);
    const grant = await media.begin("image/jpeg");
    expect(store.uploads.get(grant.key)?.tokenHash).not.toBe(grant.uploadToken);
    await objects.put(grant.key, { bytes: jpeg(2048, 128), contentType: "image/jpeg" });
    const atlas = { key: grant.key, tile: 128, columns: 16, count: 11 };
    await expect(media.finish("abcdefghij", atlas, "wrong")).rejects.toThrow(InvalidUpload);
    const saved = await media.finish("abcdefghij", atlas, grant.uploadToken);
    expect(saved.key).toMatch(/^m\/img\/abcdefghij\/atlas-[a-f0-9]{64}\.jpg$/);
    expect(objects.objects.has(saved.key)).toBe(true);
    expect(objects.objects.has(grant.key)).toBe(false);
    await expect(media.finish("abcdefghij", atlas, grant.uploadToken)).rejects.toThrow(
      InvalidUpload,
    );
  });
  it("rejects expired sessions, wrong dimensions, and oversized objects", async () => {
    const store = new MemoryStore();
    const objects = new MemoryMedia();
    let now = 100;
    const media = new Media(store, objects, () => now);
    const expired = await media.begin("image/jpeg");
    now += 601;
    await expect(
      media.finish(
        "abcdefghij",
        { key: expired.key, tile: 128, columns: 16, count: 11 },
        expired.uploadToken,
      ),
    ).rejects.toThrow(/expired/);
    for (const bytes of [jpeg(128, 128), new Uint8Array(MAX_ATLAS + 1)]) {
      const grant = await media.begin("image/jpeg");
      await objects.put(grant.key, { bytes, contentType: "image/jpeg" });
      await expect(
        media.finish(
          "abcdefghij",
          { key: grant.key, tile: 128, columns: 16, count: 11 },
          grant.uploadToken,
        ),
      ).rejects.toThrow(InvalidUpload);
    }
  });
  it("signs a bounded S3 POST and publishes the validated bytes with immutable caching", async () => {
    const client = new S3Client({
      region: "us-east-1",
      credentials: { accessKeyId: "TEST_KEY", secretAccessKey: "TEST_SECRET" },
    });
    const objects = new S3Media("test-bucket", client);
    const grant = await objects.presign("tmp/test", "image/webp");
    const policy = JSON.parse(Buffer.from(grant.fields.Policy!, "base64").toString());
    expect(policy.conditions).toContainEqual(["content-length-range", 1, MAX_ATLAS]);
    expect(policy.conditions).toContainEqual(["eq", "$Content-Type", "image/webp"]);
    const sdk = mockClient(client);
    const bytes = jpeg(2048, 128);
    sdk.on(GetObjectCommand).resolves({
      Body: {
        transformToByteArray: async () => new Uint8Array(bytes),
      } as GetObjectCommandOutput["Body"],
      ContentLength: bytes.length,
      ContentType: "image/jpeg",
    });
    sdk.on(PutObjectCommand).resolves({});
    const object = await objects.get("tmp/test");
    await objects.put("m/img/list/atlas-hash.jpg", object);
    expect(sdk.commandCalls(PutObjectCommand)[0]!.args[0].input).toMatchObject({
      Body: new Uint8Array(bytes),
      ContentType: "image/jpeg",
      CacheControl: "public,max-age=31536000,immutable",
    });
    sdk.restore();
  });
});
