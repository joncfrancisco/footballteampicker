import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

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

/** Read a SecureString once per container; a missing parameter means "not configured yet". */
export function ssmSecret(
  name: string,
  ssm = new SSMClient({}),
): () => Promise<string | undefined> {
  let cached: Promise<string | undefined> | undefined;
  return () => {
    cached ??= ssm
      .send(new GetParameterCommand({ Name: name, WithDecryption: true }))
      .then((r) => r.Parameter?.Value || undefined)
      .catch((e: Error) => {
        cached = undefined; // retry on the next request
        if (e.name === "ParameterNotFound") return undefined;
        throw e;
      });
    return cached;
  };
}
