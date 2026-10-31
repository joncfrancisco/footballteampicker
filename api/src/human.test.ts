import { describe, expect, it, vi } from "vitest";
import { TEST_SECRET, turnstile } from "./human";

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
      hostname: "h",
      fetch: reply({ success: true, hostname: "example.com" }),
    });
    expect(await check("tok", "ip")).toBe("ok");
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
