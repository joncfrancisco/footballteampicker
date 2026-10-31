import { describe, expect, it, vi } from "vitest";
import { TEST_SECRET, turnstile, ssmSecret } from "./human";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { mockClient } from "aws-sdk-client-mock";

const reply = (body: unknown, ok = true) =>
  vi.fn(async () => ({ ok, json: async () => body }) as Response);

describe("turnstile", () => {
  it("passes a successful verification for this hostname", async () => {
    const fetch = reply({ success: true, hostname: "depthchart.joncfrancis.co" });
    const check = turnstile({
      secret: async () => "real",
      hostname: "depthchart.joncfrancis.co",
      fetch,
    });
    expect(await check("tok", "1.2.3.4")).toBe("ok");
    const body = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1]
      .body as URLSearchParams;
    expect(body.get("response")).toBe("tok");
    expect(body.get("remoteip")).toBe("1.2.3.4");
  });

  it("fails a token for another hostname, a failed verification, or no token", async () => {
    const other = turnstile({
      secret: async () => "real",
      hostname: "depthchart.joncfrancis.co",
      fetch: reply({ success: true, hostname: "evil.example" }),
    });
    expect(await other("tok", "ip")).toBe("failed");
    const bad = turnstile({
      secret: async () => "real",
      hostname: "h",
      fetch: reply({ success: false }),
    });
    expect(await bad("tok", "ip")).toBe("failed");
    expect(await bad(undefined, "ip")).toBe("failed");
  });

  it("accepts any hostname with the test secret", async () => {
    const check = turnstile({
      secret: async () => TEST_SECRET,
      allowTestKeys: true,
      hostname: "h",
      fetch: reply({ success: true, hostname: "example.com" }),
    });
    expect(await check("tok", "ip")).toBe("ok");
  });

  it("rejects test secrets in production and fails closed on network errors", async () => {
    const fetch = reply({ success: true });
    expect(
      await turnstile({ secret: async () => TEST_SECRET, hostname: "h", fetch })("t", "ip"),
    ).toBe("unavailable");
    expect(fetch).not.toHaveBeenCalled();
    expect(
      await turnstile({
        secret: async () => "real",
        hostname: "h",
        fetch: vi.fn().mockRejectedValue(new Error("network")),
      })("t", "ip"),
    ).toBe("unavailable");
  });

  it("is unavailable without a secret or when Cloudflare errors", async () => {
    expect(
      await turnstile({ secret: async () => undefined, hostname: "h", fetch: reply({}) })(
        "t",
        "ip",
      ),
    ).toBe("unavailable");
    expect(
      await turnstile({ secret: async () => "s", hostname: "h", fetch: reply({}, false) })(
        "t",
        "ip",
      ),
    ).toBe("unavailable");
  });
});

describe("runtime secret references", () => {
  it("resolves a secret reference, caches it, and supports an explicit JSON field", async () => {
    const ssm = mockClient(SSMClient);
    const secrets = mockClient(SecretsManagerClient);
    ssm.reset();
    secrets.reset();
    ssm.on(GetParameterCommand).resolves({
      Parameter: { Value: "secretsmanager:test-only:SecretString:private" },
    });
    secrets
      .on(GetSecretValueCommand)
      .resolves({ SecretString: JSON.stringify({ private: "mock-secret" }) });
    const read = ssmSecret("/test");
    expect(await read()).toBe("mock-secret");
    expect(await read()).toBe("mock-secret");
    expect(secrets.commandCalls(GetSecretValueCommand)).toHaveLength(1);
    expect(ssm.commandCalls(GetParameterCommand)[0]!.args[0].input.WithDecryption).toBe(true);
    ssm.restore();
    secrets.restore();
  });
});
