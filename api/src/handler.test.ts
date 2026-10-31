import { describe, expect, it } from "vitest";
import { handler, type Event } from "./handler";

function request(method: string, path: string): Event {
  return { rawPath: path, requestContext: { http: { method, path } } } as unknown as Event;
}

describe("handler", () => {
  it("answers /api/health", async () => {
    const res = await handler(request("GET", "/api/health"));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body ?? "")).toEqual({ ok: true });
  });

  it("404s unknown routes", async () => {
    const res = await handler(request("GET", "/api/nope"));
    expect(res.statusCode).toBe(404);
  });
});
