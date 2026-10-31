import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { StoredList } from "./store";

export function listView(list: StoredList) {
  const {
    editTokenHash: _h,
    hidden: _hidden,
    uploadToken: _u,
    baseVersion: _v,
    atlas,
    ...view
  } = list;
  const { key, ...tiles } = atlas;
  return { ...view, atlas: { ...tiles, src: `/${key}` } };
}
export function browseIndex(lists: StoredList[], updatedAt: string) {
  return {
    updatedAt,
    lists: lists
      .filter((l) => l.visibility === "public" && !l.hidden)
      .map((l) => ({
        id: l.id,
        title: l.title,
        ip: l.ip,
        description: l.description,
        tags: l.tags,
        count: l.characters.length,
        twoWayCount: l.characters.filter((c) => c.twoWay).length,
        createdAt: l.createdAt,
        updatedAt: l.updatedAt,
        atlas: listView(l).atlas,
        cover: l.characters.slice(0, 4).map((c) => c.atlasIndex),
        ...(l.disclaimer ? { disclaimer: l.disclaimer } : {}),
      })),
  };
}

/**
 * Every read is a cached S3 object (#9): after each write the API publishes JSON under m/
 * in the media bucket, served by CloudFront /m/*. No invalidations: lists and browse cache
 * for 60 s and teams never change, so a write is visible within a minute without spending
 * CloudFront's free invalidation paths. Takedowns invalidate from the admin script (#13).
 */
export interface Publisher {
  put(key: string, body: unknown, cacheControl: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export const CACHE = {
  team: "public, max-age=31536000, immutable",
  list: "public, max-age=60",
  browse: "public, max-age=60",
};

export class MemoryPublisher implements Publisher {
  objects = new Map<string, { body: string; cacheControl: string }>();

  async put(key: string, body: unknown, cacheControl: string) {
    this.objects.set(key, { body: JSON.stringify(body), cacheControl });
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  json(key: string): unknown {
    const o = this.objects.get(key);
    return o ? JSON.parse(o.body) : undefined;
  }
}

export class S3Publisher implements Publisher {
  constructor(
    private bucket: string,
    private s3 = new S3Client({}),
  ) {}

  async put(key: string, body: unknown, cacheControl: string) {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(body),
        ContentType: "application/json",
        CacheControl: cacheControl,
      }),
    );
  }

  async delete(key: string) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
