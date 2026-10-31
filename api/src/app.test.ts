/* eslint-disable @typescript-eslint/no-explicit-any -- reading published JSON in assertions */
import { CharacterList, PublishedTeam, newTeam, place, setSection, type Team } from "@ftp/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import lol from "../../seed/league-of-legends/list.json";
import { createApi, clientIp } from "./app";
import type { HumanCheck } from "./human";
import { MemoryPublisher } from "./publish";
import { MemoryStore } from "./store";
import type { Event } from "./types";
import { Media, MemoryMedia } from "./media";

const seed = CharacterList.parse(lol);
let store: MemoryStore;
let publish: MemoryPublisher;
let human: ReturnType<typeof vi.fn<HumanCheck>>;
let api: ReturnType<typeof createApi>;
const notifications: unknown[] = [];

beforeEach(() => {
  notifications.length = 0;
  store = new MemoryStore();
  publish = new MemoryPublisher();
  human = vi.fn<HumanCheck>(async (token) => (token === "ok" ? "ok" : "failed"));
  api = createApi({
    store,
    media: new Media(store, new MemoryMedia()),
    publish,
    human,
    seeds: [seed],
    now: () => new Date("2026-11-01T00:00:00Z"),
    ipSalt: "test-only-salt",
    notifyReport: async (report) => {
      notifications.push(report);
    },
  });
});

function req(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Event {
  return {
    rawPath: path,
    headers: {
      "x-turnstile-token": "ok",
      "x-forwarded-for": "203.0.113.9, 198.51.100.1",
      ...headers,
    },
    requestContext: { http: { method, path } },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    isBase64Encoded: false,
  } as unknown as Event;
}
const call = async (...args: Parameters<typeof req>) => {
  const r = await api(req(...args));
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
};

const LIST = {
  title: "Test Roster",
  ip: "Test Game",
  visibility: "public",
  seedId: seed.id,
  atlas: { ...seed.atlas, key: `m/seeds/${seed.id}/${seed.atlas.src}` },
  characters: seed.characters.slice(0, 11).map((c, i) => ({ ...c, twoWay: i === 1 })),
};

function lolTeam(): Team {
  let t = setSection(newTeam(seed), "staff", true);
  for (const [id, spot] of [
    ["Ahri", { side: "offense", pos: "QB", index: 0 }],
    ["Braum", { side: "defense", pos: "MLB", index: 0 }],
    ["Zed", { side: "staff", pos: "HC", index: 0 }],
  ] as const) {
    const r = place(t, new Map(seed.characters.map((c) => [c.id, c])), id, spot);
    if (!r.ok) throw new Error(r.reason);
    t = r.team;
  }
  return t;
}

describe("routes", () => {
  it("logs normalized routes, status and latency without request secrets or IPs", async () => {
    const logs: unknown[] = [];
    const logged = createApi({
      store,
      publish,
      human,
      seeds: [seed],
      logRequest: (record) => logs.push(record),
    });
    await logged(
      req("PUT", "/api/lists/abcdefghij", LIST, {
        authorization: "Bearer private-edit-token",
        "x-turnstile-token": "private-human-token",
      }),
    );
    await logged(req("GET", "/api/secret-in-unmatched-path"));
    expect(logs).toEqual([
      { route: "PUT /api/lists/:id", status: 403, latencyMs: expect.any(Number) },
      { route: "unmatched", status: 404, latencyMs: expect.any(Number) },
    ]);
    expect(JSON.stringify(logs)).not.toMatch(/private-|198\.51|203\.0|secret-in/);
  });
  it("answers /api/health and 404s the rest", async () => {
    expect(await call("GET", "/api/health")).toEqual({
      status: 200,
      body: { ok: true, loadtest: false },
    });
    expect((await call("GET", "/api/nope")).status).toBe(404);
    expect((await call("GET", "/api/teams")).status).toBe(404);
  });
});

describe("human check", () => {
  it("rejects a write without a passing token and stores nothing", async () => {
    const r = await call("POST", "/api/teams", lolTeam(), { "x-turnstile-token": "bad" });
    expect(r).toEqual({ status: 403, body: { error: "human_check_failed" } });
    expect(store.teams.size).toBe(0);
    expect(human).toHaveBeenCalledWith("bad", "198.51.100.1");
  });

  it("pauses writes when Turnstile isn't configured", async () => {
    human.mockResolvedValue("unavailable");
    expect(await call("POST", "/api/teams", lolTeam())).toEqual({
      status: 503,
      body: { error: "writes_unavailable" },
    });
  });
});

describe("hourly rate limits", () => {
  it.each([
    ["/api/lists", 50, () => LIST],
    ["/api/uploads", 50, () => ({ contentType: "image/webp" })],
    ["/api/teams", 200, () => lolTeam()],
    ["/api/reports", 20, () => ({ targetType: "list", targetId: seed.id, reason: "Test report" })],
  ] as const)(
    "caps %s after verified requests and returns Retry-After",
    async (path, limit, body) => {
      const accepted = await Promise.all(
        Array.from({ length: limit }, () => api(req("POST", path, body()))),
      );
      expect(accepted.every((r) => [201, 204].includes(r.statusCode!))).toBe(true);
      const blocked = await api(req("POST", path, body()));
      expect(blocked.statusCode).toBe(429);
      expect(blocked.headers?.["retry-after"]).toBe("3600");
      expect([...store.rates.keys()].every((key) => !key.includes("198.51.100.1"))).toBe(true);
      expect(
        (await api(req("POST", path, body(), { "x-forwarded-for": "198.51.100.2" }))).statusCode,
      ).not.toBe(429);
    },
  );
  it("doesn't count failed verification and starts a fresh window the next hour", async () => {
    await call("POST", "/api/teams", lolTeam(), { "x-turnstile-token": "bad" });
    expect(store.rates.size).toBe(0);
    for (let i = 0; i < 200; i++) await call("POST", "/api/teams", lolTeam());
    const next = createApi({
      store,
      publish,
      human,
      seeds: [seed],
      ipSalt: "test-only-salt",
      now: () => new Date("2026-11-01T01:00:00Z"),
    });
    expect((await next(req("POST", "/api/teams", lolTeam()))).statusCode).toBe(201);
  });
});

describe("load-test window (#18)", () => {
  const secret = "l".repeat(40);
  const windowApi = (token: string | undefined) =>
    createApi({
      store,
      publish,
      human,
      seeds: [seed],
      ipSalt: "test-only-salt",
      now: () => new Date("2026-11-01T00:00:00Z"),
      loadtestToken: async () => token,
    });

  it("skips Turnstile and rate limits only for the window's secret", async () => {
    const api = windowApi(secret);
    const health = await api(req("GET", "/api/health"));
    expect(JSON.parse(health.body!)).toEqual({ ok: true, loadtest: true });
    const headers = { "x-turnstile-token": "", "x-loadtest-token": secret };
    for (let i = 0; i < 201; i++)
      expect((await api(req("POST", "/api/teams", lolTeam(), headers))).statusCode).toBe(201);
    expect(human).not.toHaveBeenCalled();
    expect(store.rates.size).toBe(0);
  });

  it("treats a wrong, short or unconfigured token as an ordinary request", async () => {
    const wrong = { "x-turnstile-token": "bad", "x-loadtest-token": "x".repeat(40) };
    expect((await windowApi(secret)(req("POST", "/api/teams", lolTeam(), wrong))).statusCode).toBe(
      403,
    );
    const short = { "x-turnstile-token": "bad", "x-loadtest-token": "short" };
    expect((await windowApi("short")(req("POST", "/api/teams", lolTeam(), short))).statusCode).toBe(
      403,
    );
    const off = { "x-turnstile-token": "bad", "x-loadtest-token": secret };
    expect((await api(req("POST", "/api/teams", lolTeam(), off))).statusCode).toBe(403);
  });
});

describe("teams", () => {
  it("saves a valid team against a seed list, snapshots characters, publishes immutable JSON", async () => {
    const r = await call("POST", "/api/teams", lolTeam());
    expect(r.status).toBe(201);
    const id = r.body.id as string;
    expect(id).toMatch(/^[A-Za-z0-9]{10}$/);

    const saved = publish.json(`m/t/${id}.json`) as Record<string, any>;
    expect(publish.objects.get(`m/t/${id}.json`)!.cacheControl).toContain("immutable");
    expect(saved).toMatchObject({
      schema: 1,
      id,
      listId: "demo-lol",
      listVersion: 0,
      title: "My League of Legends Team",
    });
    expect(Object.keys(saved.characters).sort()).toEqual(["Ahri", "Braum", "Zed"]);
    expect(saved.characters.Ahri).toEqual({
      name: "Ahri",
      twoWay: false,
      atlasIndex: expect.any(Number),
    });
    expect(saved.disclaimer).toMatch(/Riot/);
    expect(PublishedTeam.parse(saved).atlas.src).toBe(`/m/seeds/demo-lol/${seed.atlas.src}`);
    expect(saved.staff.HC).toBe("Zed");
    expect(saved).not.toHaveProperty("specialTeams");
  });

  it("rejects a team that breaks the rules, with the reasons", async () => {
    const t = lolTeam();
    t.defense.depth.FS![0] = "Ahri"; // one-way, already QB1
    const r = await call("POST", "/api/teams", t);
    expect(r).toEqual({
      status: 422,
      body: { error: "invalid_team", errors: ["Ahri isn't a two-way player"] },
    });
  });

  it("rejects characters that aren't in the list and unknown lists", async () => {
    const t = lolTeam();
    t.offense.depth.RB![0] = "Nobody";
    expect((await call("POST", "/api/teams", t)).body.errors).toContain(
      'Unknown character "Nobody"',
    );
    expect((await call("POST", "/api/teams", { ...lolTeam(), listId: "missing" })).status).toBe(
      404,
    );
  });

  it("validates the body: bad JSON, schema, size", async () => {
    expect((await call("POST", "/api/teams", "{")).body.error).toBe("invalid_json");
    expect((await call("POST", "/api/teams", { title: "x" })).body.error).toBe("invalid");
    const big = { ...lolTeam(), title: "x", pad: "y".repeat(70_000) };
    expect((await call("POST", "/api/teams", big)).status).toBe(413);
  });

  it("refuses a team built against an older list version", async () => {
    const { body } = await call("POST", "/api/lists", LIST);
    await call("PUT", `/api/lists/${body.id}`, LIST, { authorization: `Bearer ${body.editToken}` });
    const t = { ...newTeam({ id: body.id, ip: "Test Game" }), listVersion: 1 };
    expect(await call("POST", "/api/teams", t)).toEqual({
      status: 409,
      body: { error: "list_changed", version: 2 },
    });
    const ok = await call("POST", "/api/teams", { ...t, listVersion: 2 });
    expect(ok.status).toBe(201);
    expect((publish.json(`m/t/${ok.body.id}.json`) as any).atlas.src).toBe(`/${LIST.atlas.key}`);
  });
});

describe("lists", () => {
  it("consumes the verified upload session for one save without a second challenge", async () => {
    const objects = new MemoryMedia();
    api = createApi({
      store,
      publish,
      human,
      seeds: [seed],
      media: new Media(store, objects),
      ipSalt: "test-only-salt",
    });
    const { body: grant } = await call("POST", "/api/uploads", { contentType: "image/jpeg" });
    const bytes = Buffer.from([
      0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 128, 8, 0, 1, 1, 0x11, 0, 0xff, 0xd9,
    ]);
    await objects.put(grant.key, { bytes, contentType: "image/jpeg" });
    const input = {
      ...LIST,
      atlas: { key: grant.key, tile: 128, columns: 16, count: 11 },
      uploadToken: grant.uploadToken,
    };
    expect((await call("POST", "/api/lists", input, { "x-turnstile-token": "" })).status).toBe(201);
    expect(human).toHaveBeenCalledTimes(1);
    expect(store.lists.size).toBe(1);
    expect((await call("POST", "/api/lists", input, { "x-turnstile-token": "" })).status).toBe(422);
    expect(store.lists.size).toBe(1);
  });
  it("rejects foreign atlases and stale edits without changing a list", async () => {
    const { body } = await call("POST", "/api/lists", LIST);
    const authorization = `Bearer ${body.editToken}`;
    const foreign = {
      ...LIST,
      atlas: { ...LIST.atlas, key: `m/img/abcdefghij/atlas-${"a".repeat(64)}.webp` },
    };
    expect((await call("POST", "/api/lists", foreign)).status).toBe(422);
    expect((await call("PUT", `/api/lists/${body.id}`, foreign, { authorization })).status).toBe(
      422,
    );
    expect(
      (await call("PUT", `/api/lists/${body.id}`, { ...LIST, baseVersion: 9 }, { authorization }))
        .status,
    ).toBe(409);
    expect(store.lists.get(body.id)?.version).toBe(1);
  });

  it("issues an upload session only after verification and rejects forged seed exemptions", async () => {
    expect(
      (
        await call(
          "POST",
          "/api/uploads",
          { contentType: "image/webp" },
          { "x-turnstile-token": "bad" },
        )
      ).status,
    ).toBe(403);
    expect(store.uploads.size).toBe(0);
    const { status, body } = await call("POST", "/api/uploads", { contentType: "image/webp" });
    expect(status).toBe(201);
    expect(store.uploads.get(body.key)?.tokenHash).not.toBe(body.uploadToken);
    expect((await call("POST", "/api/lists", { ...LIST, seedId: "unknown-seed" })).status).toBe(
      400,
    );
    const characters = Array.from({ length: 151 }, (_, i) => ({
      id: `new${i}`,
      name: `New ${i}`,
      atlasIndex: 0,
    }));
    expect((await call("POST", "/api/lists", { ...LIST, characters })).status).toBe(400);
  });
  it("creates a list, returns the edit token once, stores only its hash, publishes JSON and browse", async () => {
    const r = await call("POST", "/api/lists", LIST);
    expect(r.status).toBe(201);
    const { id, editToken } = r.body;
    expect(editToken).toHaveLength(43);
    const stored = store.lists.get(id)!;
    expect(stored.editTokenHash).not.toContain(editToken);
    expect(publish.json(`m/l/${id}.json`)).not.toHaveProperty("editTokenHash");
    expect(publish.json(`m/l/${id}.json`)).toMatchObject({ atlas: { src: `/${LIST.atlas.key}` } });
    expect((publish.json("m/browse/index.json") as any).lists[0]).toMatchObject({
      count: 11,
      twoWayCount: 1,
      cover: [0, 1, 2, 3],
      createdAt: "2026-11-01T00:00:00.000Z",
      atlas: { src: `/${LIST.atlas.key}` },
    });
    expect((publish.json("m/browse/index.json") as any).lists.map((l: any) => l.id)).toEqual([id]);
  });

  it("keeps unlisted lists out of browse", async () => {
    await call("POST", "/api/lists", { ...LIST, visibility: "unlisted" });
    expect(publish.json("m/browse/index.json")).toBeUndefined();
  });

  it("updates with the edit token and bumps the version; refuses a wrong token", async () => {
    const { body } = await call("POST", "/api/lists", LIST);
    const path = `/api/lists/${body.id}`;
    expect((await call("PUT", path, LIST, { authorization: "Bearer nope" })).status).toBe(401);
    expect((await call("PUT", path, LIST)).status).toBe(401);
    const r = await call(
      "PUT",
      path,
      { ...LIST, title: "Renamed" },
      { authorization: `Bearer ${body.editToken}` },
    );
    expect(r).toMatchObject({
      status: 200,
      body: { id: body.id, version: 2, atlas: { key: LIST.atlas.key } },
    });
    expect((publish.json(`m/l/${body.id}.json`) as any).title).toBe("Renamed");
  });

  it("deletes with the edit token; saved teams keep their snapshot", async () => {
    const { body } = await call("POST", "/api/lists", LIST);
    const team = await call("POST", "/api/teams", { ...newTeam({ id: body.id, ip: "X" }) });
    const r = await call("DELETE", `/api/lists/${body.id}`, undefined, {
      authorization: `Bearer ${body.editToken}`,
    });
    expect(r.status).toBe(204);
    expect(store.lists.has(body.id)).toBe(false);
    expect(publish.json(`m/l/${body.id}.json`)).toBeUndefined();
    expect((publish.json("m/browse/index.json") as any).lists).toEqual([]);
    expect(publish.json(`m/t/${team.body.id}.json`)).toBeDefined();
  });
});

describe("reports", () => {
  it("stores a report with a hashed IP", async () => {
    const saved = await call("POST", "/api/teams", lolTeam());
    expect(
      (
        await call("POST", "/api/reports", {
          targetId: saved.body.id,
          targetType: "team",
          reason: "spam",
        })
      ).status,
    ).toBe(204);
    expect(store.reports[0]).toMatchObject({ targetId: saved.body.id, reason: "spam" });
    expect(store.reports[0]!.ipHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("deduplicates networks, notifies once per reporter, and hides a list after three reports", async () => {
    const created = await call("POST", "/api/lists", LIST);
    const id = created.body.id as string;
    const report = { targetId: id, targetType: "list", reason: "Prohibited image" };
    for (const ip of ["198.51.100.1", "198.51.100.1", "198.51.100.2", "198.51.100.3"]) {
      expect((await call("POST", "/api/reports", report, { "x-forwarded-for": ip })).status).toBe(
        204,
      );
    }
    expect(store.reports).toHaveLength(3);
    expect(notifications).toHaveLength(3);
    expect(store.lists.get(id)?.hidden).toBe(true);
    expect(publish.json(`m/l/${id}.json`)).toBeUndefined();
    expect(publish.json("m/browse/index.json")).toMatchObject({ lists: [] });
    expect(
      (
        await call("PUT", `/api/lists/${id}`, LIST, {
          authorization: `Bearer ${created.body.editToken}`,
        })
      ).status,
    ).toBe(404);
    expect((await call("POST", "/api/teams", newTeam({ id, ip: "Test" }))).status).toBe(404);
  });

  it("rejects missing targets and fails closed without a reporter salt", async () => {
    expect(
      (
        await call("POST", "/api/reports", {
          targetType: "team",
          targetId: "missing",
          reason: "spam",
        })
      ).status,
    ).toBe(404);
    const unavailable = createApi({
      store,
      publish,
      human,
      seeds: [seed],
      reporterSalt: async () => undefined,
    });
    expect(
      (
        await unavailable(
          req("POST", "/api/reports", { targetType: "list", targetId: seed.id, reason: "spam" }),
        )
      ).statusCode,
    ).toBe(503);
    expect(store.reports).toHaveLength(0);
  });
});

describe("clientIp", () => {
  it("prefers CloudFront-Viewer-Address, then the last X-Forwarded-For hop", () => {
    expect(
      clientIp(req("GET", "/", undefined, { "cloudfront-viewer-address": "2001:db8::1:443" })),
    ).toBe("2001:db8::1");
    expect(clientIp(req("GET", "/"))).toBe("198.51.100.1");
  });
});
