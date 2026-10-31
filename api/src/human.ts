import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

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
  allowTestKeys?: boolean;
}): HumanCheck {
  const doFetch = opts.fetch ?? fetch;
  return async (token, ip) => {
    if (!token) return "failed";
    const secret = await opts.secret();
    if (!secret) return "unavailable";
    if (secret === TEST_SECRET && !opts.allowTestKeys) return "unavailable";
    const body = new URLSearchParams({ secret, response: token, remoteip: ip });
    try {
      const r = await doFetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body,
        signal: AbortSignal.timeout(4000),
      });
      if (!r.ok) return "unavailable";
      const result = (await r.json()) as { success?: boolean; hostname?: string };
      if (!result.success) return "failed";
      // Test keys answer for any hostname; real keys must match this site.
      if (secret !== TEST_SECRET && result.hostname !== opts.hostname) return "failed";
      return "ok";
    } catch {
      return "unavailable";
    }
  };
}

/** Read a SecureString once per container; a missing parameter means "not configured yet". */
export function ssmSecret(
  name: string,
  ssm = new SSMClient({}),
  secrets = new SecretsManagerClient({}),
): () => Promise<string | undefined> {
  let cached: Promise<string | undefined> | undefined;
  return () => {
    cached ??= ssm
      .send(new GetParameterCommand({ Name: name, WithDecryption: true }))
      .then(async (r) => {
        const value = r.Parameter?.Value;
        if (!value) return undefined;
        const reference = value.match(/^secretsmanager:([^:]+)(?::SecretString(?::([^:]+))?)?$/);
        if (!reference) return value;
        const result = await secrets.send(new GetSecretValueCommand({ SecretId: reference[1]! }));
        if (!result.SecretString) return undefined;
        try {
          const parsed: unknown = JSON.parse(result.SecretString);
          if (typeof parsed === "string") return parsed;
          if (!parsed || typeof parsed !== "object") return undefined;
          const fields = parsed as Record<string, unknown>;
          if (reference[2])
            return typeof fields[reference[2]] === "string"
              ? (fields[reference[2]] as string)
              : undefined;
          const field = Object.keys(fields).find((key) =>
            ["secret", "secretkey", "turnstilesecret", "turnstilesecretkey", "key"].includes(
              key.replace(/[\s_-]/g, "").toLowerCase(),
            ),
          );
          return field && typeof fields[field] === "string" ? (fields[field] as string) : undefined;
        } catch {
          return reference[2] ? undefined : result.SecretString;
        }
      })
      .catch((e: Error) => {
        cached = undefined; // retry on the next request
        if (e.name === "ParameterNotFound" || e.name === "ResourceNotFoundException")
          return undefined;
        throw e;
      });
    return cached;
  };
}
