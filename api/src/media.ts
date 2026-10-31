import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { createHash, randomUUID } from "node:crypto";
import type { ListInput } from "@ftp/shared";
import { newEditToken, sha256 } from "./ids";
import type { Store } from "./store";

export const MAX_ATLAS = 1_500_000;
export class InvalidUpload extends Error {}
export type Grant = {
  key: string;
  uploadToken: string;
  url: string;
  fields: Record<string, string>;
};
type ObjectData = { bytes: Uint8Array; contentType: string };
export interface MediaObjects {
  presign(
    key: string,
    contentType: string,
  ): Promise<{ url: string; fields: Record<string, string> }>;
  get(key: string): Promise<ObjectData>;
  put(key: string, object: ObjectData): Promise<void>;
  delete(key: string): Promise<void>;
}

export class Media {
  constructor(
    private store: Store,
    private objects: MediaObjects,
    private now = () => Math.floor(Date.now() / 1000),
  ) {}
  async begin(contentType: string): Promise<Grant> {
    const key = `tmp/${randomUUID()}`;
    const uploadToken = newEditToken();
    await this.store.putUpload({
      key,
      tokenHash: sha256(uploadToken),
      contentType,
      expiresAt: this.now() + 600,
    });
    return { key, uploadToken, ...(await this.objects.presign(key, contentType)) };
  }
  async finish(listId: string, atlas: ListInput["atlas"], token?: string) {
    if (
      !token ||
      !atlas.key.startsWith("tmp/") ||
      !(await this.store.claimUpload(atlas.key, sha256(token), this.now()))
    )
      throw new InvalidUpload("Upload session is missing, expired, or already used");
    let object: ObjectData;
    try {
      object = await this.objects.get(atlas.key);
    } catch (e) {
      if ((e as Error).name === "NoSuchKey") throw new InvalidUpload("Upload not found");
      throw e;
    }
    if (!object.bytes.length || object.bytes.length > MAX_ATLAS)
      throw new InvalidUpload("Atlas must be at most 1.5 MB");
    const size = imageSize(object.bytes, object.contentType);
    if (
      atlas.tile !== 128 ||
      atlas.columns !== 16 ||
      size.width !== atlas.tile * atlas.columns ||
      size.height !== atlas.tile * Math.ceil(atlas.count / atlas.columns)
    )
      throw new InvalidUpload("Atlas dimensions do not match its tiles");
    const hash = createHash("sha256").update(object.bytes).digest("hex");
    const key = `m/img/${listId}/atlas-${hash}.${object.contentType === "image/webp" ? "webp" : "jpg"}`;
    // Publish exactly the bytes we validated; a second presigned POST cannot race a copy.
    await this.objects.put(key, object);
    await this.objects.delete(atlas.key);
    return { ...atlas, key };
  }
}

export function imageSize(
  bytes: Uint8Array,
  contentType: string,
): { width: number; height: number } {
  const b = Buffer.from(bytes);
  if (
    contentType === "image/webp" &&
    b.length >= 30 &&
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP" &&
    b.readUInt32LE(4) + 8 === b.length &&
    b.readUInt32LE(16) + 20 <= b.length
  ) {
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8 " && b.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a])))
      return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (kind === "VP8L" && b[20] === 0x2f)
      return {
        width: 1 + (b.readUInt32LE(21) & 0x3fff),
        height: 1 + ((b.readUInt32LE(21) >>> 14) & 0x3fff),
      };
    if (kind === "VP8X" && !(b[20]! & 0x02))
      return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  }
  if (
    contentType === "image/jpeg" &&
    b.length > 4 &&
    b.readUInt16BE(0) === 0xffd8 &&
    b.readUInt16BE(b.length - 2) === 0xffd9
  ) {
    let at = 2;
    while (at + 4 < b.length && b[at] === 0xff) {
      while (b[at] === 0xff) at++;
      const marker = b[at++]!;
      if (at + 2 > b.length) break;
      const size = b.readUInt16BE(at);
      if (size < 2 || at + size > b.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && size >= 8)
        return { height: b.readUInt16BE(at + 3), width: b.readUInt16BE(at + 5) };
      at += size;
    }
  }
  throw new InvalidUpload("Atlas must be a valid, non-animated WebP or JPEG");
}

export class S3Media implements MediaObjects {
  constructor(
    private bucket: string,
    private s3 = new S3Client({}),
  ) {}
  async presign(key: string, contentType: string) {
    return createPresignedPost(this.s3, {
      Bucket: this.bucket,
      Key: key,
      Expires: 600,
      Fields: { "Content-Type": contentType },
      Conditions: [
        ["content-length-range", 1, MAX_ATLAS],
        ["eq", "$Content-Type", contentType],
      ],
    });
  }
  async get(key: string) {
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if ((r.ContentLength ?? Infinity) > MAX_ATLAS) {
      (r.Body as { destroy?: () => void } | undefined)?.destroy?.();
      throw new InvalidUpload("Atlas is too large");
    }
    if (!r.Body) throw new InvalidUpload("Upload not found");
    return { bytes: await r.Body.transformToByteArray(), contentType: r.ContentType ?? "" };
  }
  async put(key: string, object: ObjectData) {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: object.bytes,
        ContentType: object.contentType,
        CacheControl: "public,max-age=31536000,immutable",
      }),
    );
  }
  async delete(key: string) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export class MemoryMedia implements MediaObjects {
  objects = new Map<string, ObjectData>();
  pending = new Map<string, string>();
  async presign(key: string, contentType: string) {
    this.pending.set(key, contentType);
    return {
      url: `/api/local-upload/${key.slice(4)}`,
      fields: { key, "Content-Type": contentType },
    };
  }
  async get(key: string) {
    const object = this.objects.get(key);
    if (!object) throw new InvalidUpload("Upload not found");
    return object;
  }
  async put(key: string, object: ObjectData) {
    this.objects.set(key, object);
  }
  async delete(key: string) {
    this.objects.delete(key);
    this.pending.delete(key);
  }
}
