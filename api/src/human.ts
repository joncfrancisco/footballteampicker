import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

/**
 * Cloudflare Turnstile (#17): every write carries a single-use token, verified server-side
 * before anything is stored.
 */
export type HumanCheck = (
  token: string | undefined,
  ip: string,
) => Promise<"ok" | "failed" | "unavailable">;

/** Cloudflare's documented always-pass test secret, for local dev and tests. */
export const TEST_SECRET = "1x0000000000000000000000000000000AA";

export function turnstile(opts: {
  /** Returns the secret, or undefined if it isn't configured yet. */
  secret: () => Promise<string | undefined>;
  hostname: string;
  fetch?: typeof fetch;
}): HumanCheck {
  const doFetch = opts.fetch ?? fetch;
  return async (token, ip) => {
    const secret = await opts.secret();
    if (!secret) return "unavailable";
    if (!token) return "failed";
    const body = new URLSearchParams({ secret, response: token, remoteip: ip });
    const r = await doFetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
    });
    if (!r.ok) return "unavailable";
    const result = (await r.json()) as { success?: boolean; hostname?: string };
    if (!result.success) return "failed";
    // Test keys answer for any hostname; real keys must match this site.
    if (secret !== TEST_SECRET && result.hostname !== opts.hostname) return "failed";
    return "ok";
  };
}

/**
 * Read a Secrets Manager secret once per container; a missing secret means "not configured
 * yet". The value may be a plain string or a JSON object holding it (under "secret",
 * "turnstile-secret", or as its only value).
 */
export function managedSecret(
  id: string,
  client = new SecretsManagerClient({}),
): () => Promise<string | undefined> {
  let cached: Promise<string | undefined> | undefined;
  return () => {
    cached ??= client
      .send(new GetSecretValueCommand({ SecretId: id }))
      .then((r) => secretValue(r.SecretString))
      .catch((e: Error) => {
        cached = undefined; // retry on the next request
        if (e.name === "ResourceNotFoundException") return undefined;
        throw e;
      });
    return cached;
  };
}

export function secretValue(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const o = parsed as Record<string, unknown>;
      const v =
        o.secret ??
        o["turnstile-secret"] ??
        (Object.keys(o).length === 1 ? Object.values(o)[0] : undefined);
      return typeof v === "string" && v ? v : undefined;
    }
  } catch {
    // not JSON: the secret itself
  }
  return raw.trim() || undefined;
}
