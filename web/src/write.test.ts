import { createHash, webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { writeJson, WriteError } from "./write";
afterEach(() => vi.unstubAllGlobals());
it("sends the exact payload hash required by Lambda OAC and never leaks edit tokens into a URL", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "shared1234" })));
  vi.stubGlobal("fetch", fetch);
  const body = { title: "A team 🏈" };
  await writeJson("/api/teams", body, "human", { editToken: "edit-secret" });
  expect(fetch).toHaveBeenCalledWith(
    "/api/teams",
    expect.objectContaining({
      body: JSON.stringify(body),
      headers: expect.objectContaining({
        "x-amz-content-sha256": createHash("sha256").update(JSON.stringify(body)).digest("hex"),
        "x-turnstile-token": "human",
        authorization: "Bearer edit-secret",
      }),
    }),
  );
});
it("reports paused sharing without retrying a consumed Turnstile token", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response('{"error":"rate_limited"}', { status: 429 }));
  vi.stubGlobal("fetch", fetch);
  await expect(writeJson("/api/teams", {}, "single-use")).rejects.toBeInstanceOf(WriteError);
  expect(fetch).toHaveBeenCalledTimes(1);
});
