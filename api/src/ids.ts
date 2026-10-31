import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** 10-character base62 id (~59 bits), unbiased. */
export function newId(): string {
  let out = "";
  while (out.length < 10) {
    for (const b of randomBytes(16)) {
      if (b < 248 && out.length < 10) out += BASE62[b % 62];
    }
  }
  return out;
}

/** 32 random bytes, returned to the creator once; only its hash is stored. */
export function newEditToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function tokenMatches(token: string, hash: string): boolean {
  const a = Buffer.from(sha256(token), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
