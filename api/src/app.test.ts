/* eslint-disable @typescript-eslint/no-explicit-any -- reading published JSON in assertions */
import { CharacterList, newTeam, place, setSection, type Team } from "@ftp/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import lol from "../../seed/league-of-legends/list.json";
import { createApi, clientIp } from "./app";
import type { HumanCheck } from "./human";
import { MemoryPublisher } from "./publish";
import { MemoryStore } from "./store";
import type { Event } from "./types";

const seed = CharacterList.parse(lol);
let store: MemoryStore;
let publish: MemoryPublisher;
let human: ReturnType<typeof vi.fn<HumanCheck>>;
let api: ReturnType<typeof createApi>;

beforeEach(() => {
  store = new MemoryStore();
  publish = new MemoryPublisher();
  human = vi.fn<HumanCheck>(async (token) => (token === "ok" ? "ok" : "failed"));
  api = createApi({
    store,
    publish,
    human,
    seeds: [seed],
    now: () => new Date("2026-11-01T00:00:00Z"),
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
  atlas: { key: "m/a/abc.webp", tile: 120, columns: 4, count: 3 },
  characters: [
    { id: "a", name: "Alpha", atlasIndex: 0 },
    { id: "b", name: "Bravo", atlasIndex: 1, twoWay: true },
    { id: "c", name: "Charlie", atlasIndex: 2 },
  ],
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
  it("answers /api/health and 404s the rest", async () => {
    expect(await call("GET", "/api/health")).toEqual({ status: 200, body: { ok: true } });
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
    expect((publish.json(`m/t/${ok.body.id}.json`) as any).atlas.src).toBe("/m/a/abc.webp");
  });
});

describe("lists", () => {
  it("creates a list, returns the edit token once, stores only its hash, publishes JSON and browse", async () => {
    const r = await call("POST", "/api/lists", LIST);
    expect(r.status).toBe(201);
    const { id, editToken } = r.body;
    expect(editToken).toHaveLength(43);
    const stored = store.lists.get(id)!;
    expect(stored.editTokenHash).not.toContain(editToken);
    expect(publish.json(`m/l/${id}.json`)).not.toHaveProperty("editTokenHash");
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
    expect(r).toEqual({ status: 200, body: { id: body.id, version: 2 } });
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
    expect(
      (await call("POST", "/api/reports", { targetId: "abc", targetType: "team", reason: "spam" }))
        .status,
    ).toBe(204);
    expect(store.reports[0]).toMatchObject({ targetId: "abc", reason: "spam" });
    expect(store.reports[0]!.ipHash).toMatch(/^[0-9a-f]{64}$/);
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
