import { createHash, webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { writeJson, WriteError } from "./write";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
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

it("retries a write Lambda throttled before the API ran, with the same unused token", async () => {
  vi.stubGlobal("crypto", webcrypto);
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  const throttled = () =>
    new Response('{"Reason":"ReservedFunctionConcurrentInvocationLimitExceeded"}', {
      status: 429,
    });
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(throttled())
    .mockResolvedValueOnce(new Response("<html>503</html>", { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: "shared1234" }), { status: 201 }));
  vi.stubGlobal("fetch", fetch);
  const saved = writeJson("/api/teams", {}, "human");
  // The payload hash is real async work, so step the backoff timers until the save settles.
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(5000);
  await expect(saved).resolves.toEqual({ id: "shared1234" });
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("gives up after three retries and shows sharing as paused", async () => {
  vi.stubGlobal("crypto", webcrypto);
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  const fetch = vi.fn().mockImplementation(async () => new Response("{}", { status: 429 }));
  vi.stubGlobal("fetch", fetch);
  const saved = writeJson("/api/teams", {}, "human");
  const failed = expect(saved).rejects.toMatchObject({ status: 429 });
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(5000);
  await failed;
  expect(fetch).toHaveBeenCalledTimes(4);
});
