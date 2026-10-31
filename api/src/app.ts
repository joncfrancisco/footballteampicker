import {
  CharacterList,
  ListInput,
  ReportInput,
  UploadInput,
  TeamInput,
  teamErrors,
  type Character,
  type Team,
} from "@ftp/shared";
import type { z } from "zod";
import type { HumanCheck } from "./human";
import { newEditToken, newId, sha256, tokenMatches } from "./ids";
import { CACHE, browseIndex, listView, type Publisher } from "./publish";
import {
  VersionConflict,
  type CharacterSnapshot,
  type Store,
  type StoredList,
  type StoredTeam,
} from "./store";
import type { Event, Result } from "./types";
import { InvalidUpload, type Media } from "./media";

export type Deps = {
  logRequest?: (record: { route: string; status: number; latencyMs: number }) => void;
  media?: Media;
  store: Store;
  publish: Publisher;
  human: HumanCheck;
  /** Built-in lists (`demo-*`), bundled rather than stored. */
  seeds: CharacterList[];
  now?: () => Date;
  /** Salt for hashing reporter IPs. */
  ipSalt?: string;
  reporterSalt?: () => Promise<string | undefined>;
  notifyReport?: (report: {
    targetType: "list" | "team";
    targetId: string;
    reason: string;
  }) => Promise<void>;
  /**
   * Load-test window only (#18): a request carrying this secret in `x-loadtest-token` skips
   * Turnstile and the app rate limits. Absent in normal production, so nothing is skipped.
   */
  loadtestToken?: () => Promise<string | undefined>;
};

const MAX_BODY = 64 * 1024;
const RATE_LIMITS = { lists: 50, uploads: 50, teams: 200, reports: 20 } as const;

class HttpError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
    public headers: Record<string, string> = {},
  ) {
    super(String(body.error));
  }
}

function json(statusCode: number, body?: unknown): Result {
  return {
    statusCode,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: body === undefined ? "" : JSON.stringify(body),
  };
}

/**
 * The API: writes only (#9). Every read is a published S3 object under /m/*, so viewing and
 * browsing never invoke this function. Every write checks a Turnstile token first (#17).
 */
export function createApi(deps: Deps) {
  const now = () => (deps.now ?? (() => new Date()))().toISOString();
  const seeds = new Map(deps.seeds.map((l) => [l.id, l]));

  const routes: [string, RegExp, (e: Event, m: RegExpMatchArray) => Promise<Result>, string][] = [
    [
      "GET",
      /^\/api\/health$/,
      // The deploy smoke test checks `loadtest` so a load-test window can't outlive its deploy.
      async () => json(200, { ok: true, loadtest: !!deps.loadtestToken }),
      "GET /api/health",
    ],
    ["POST", /^\/api\/lists$/, createList, "POST /api/lists"],
    ["PUT", /^\/api\/lists\/([A-Za-z0-9]{10})$/, updateList, "PUT /api/lists/:id"],
    ["DELETE", /^\/api\/lists\/([A-Za-z0-9]{10})$/, deleteList, "DELETE /api/lists/:id"],
    ["POST", /^\/api\/teams$/, createTeam, "POST /api/teams"],
    ["POST", /^\/api\/reports$/, createReport, "POST /api/reports"],
    ["POST", /^\/api\/uploads$/, createUpload, "POST /api/uploads"],
  ];

  async function handle(event: Event): Promise<Result> {
    const started = performance.now();
    const result = await dispatch(event);
    deps.logRequest?.({
      route:
        routes.find(
          ([method, pattern]) =>
            method === event.requestContext.http.method && pattern.test(event.rawPath),
        )?.[3] ?? "unmatched",
      status: result.statusCode ?? 200,
      latencyMs: Math.round((performance.now() - started) * 100) / 100,
    });
    return result;
  }

  async function dispatch(event: Event): Promise<Result> {
    const method = event.requestContext.http.method;
    const path = event.rawPath;
    try {
      for (const [m, re, fn] of routes) {
        const match = path.match(re);
        if (match && m === method) return await fn(event, match);
      }
      return json(404, { error: "not_found" });
    } catch (e) {
      if (e instanceof HttpError) {
        const result = json(e.status, e.body);
        result.headers = { ...result.headers, ...e.headers };
        return result;
      }
      if (e instanceof InvalidUpload)
        return json(422, { error: "invalid_upload", message: e.message });
      if (/AccessDenied|Unauthorized/.test((e as Error).name ?? ""))
        return json(503, { error: "writes_unavailable" });
      console.error(JSON.stringify({ msg: "unhandled", errorType: (e as Error).name ?? "Error" }));
      return json(500, { error: "internal" });
    }
  }

  // ---- Routes ----------------------------------------------------------------------------

  async function createList(event: Event) {
    const input = parse(ListInput, event);
    const session = !!input.uploadToken && input.atlas.key.startsWith("tmp/");
    if (!session) {
      await requireHuman(event);
      await enforceRate(event, "lists");
    }
    const id = newId();
    const prepared = await prepareList(
      input,
      id,
      undefined,
      session ? () => enforceRate(event, "lists") : undefined,
    );
    const editToken = newEditToken();
    const at = now();
    const list: StoredList = {
      ...prepared,
      id,
      editTokenHash: sha256(editToken),
      version: 1,
      createdAt: at,
      updatedAt: at,
    };
    await deps.store.putList(list);
    await publishList(list);
    return json(201, { id, editToken, version: 1, atlas: prepared.atlas });
  }

  async function updateList(event: Event, [, id]: RegExpMatchArray) {
    const input = parse(ListInput, event);
    const session = !!input.uploadToken && input.atlas.key.startsWith("tmp/");
    if (!session) {
      await requireHuman(event);
      await enforceRate(event, "lists");
    }
    const current = await ownedList(event, id!);
    if (input.baseVersion !== undefined && input.baseVersion !== current.version)
      throw new HttpError(409, { error: "conflict" });
    const prepared = await prepareList(
      input,
      current.id,
      current,
      session ? () => enforceRate(event, "lists") : undefined,
    );
    const list: StoredList = {
      ...current,
      ...prepared,
      version: current.version + 1,
      updatedAt: now(),
    };
    try {
      await deps.store.putList(list, current.version);
    } catch (e) {
      if (e instanceof VersionConflict) throw new HttpError(409, { error: "conflict" });
      throw e;
    }
    await publishList(list);
    return json(200, { id, version: list.version, atlas: prepared.atlas });
  }

  async function deleteList(event: Event, [, id]: RegExpMatchArray) {
    await requireHuman(event);
    await enforceRate(event, "lists");
    const current = await ownedList(event, id!);
    await deps.store.deleteList(current.id);
    // Saved teams keep their own snapshot, so their links keep working.
    await deps.publish.delete(`m/l/${id}.json`);
    if (current.visibility === "public") await rebuildBrowse();
    return json(204);
  }

  async function createTeam(event: Event) {
    await requireHuman(event);
    await enforceRate(event, "teams");
    const input = parse(TeamInput, event) as TeamInput & Team;
    const list = await listFor(input.listId);
    if (input.listVersion !== undefined && input.listVersion !== list.version)
      throw new HttpError(409, { error: "list_changed", version: list.version });

    const byId = new Map(list.characters.map((c) => [c.id, c]));
    const errors = teamErrors(input, byId);
    if (errors.length) throw new HttpError(422, { error: "invalid_team", errors });

    const characters: Record<string, CharacterSnapshot> = {};
    for (const id of usedIds(input)) {
      const c = byId.get(id)!;
      characters[id] = { name: c.name, twoWay: c.twoWay, atlasIndex: c.atlasIndex };
    }
    const id = newId();
    const { listVersion: _v, ...team } = input;
    const stored: StoredTeam = {
      ...team,
      schema: 1,
      id,
      listVersion: list.version,
      listTitle: list.title,
      atlas: list.atlas,
      characters,
      ...(list.disclaimer ? { disclaimer: list.disclaimer } : {}),
      createdAt: now(),
    };
    await deps.store.putTeam(stored);
    await deps.publish.put(`m/t/${id}.json`, stored, CACHE.team);
    return json(201, { id });
  }

  async function createReport(event: Event) {
    await requireHuman(event);
    await enforceRate(event, "reports");
    const input = parse(ReportInput, event);
    const exists =
      input.targetType === "list"
        ? seeds.has(input.targetId) || (await deps.store.getList(input.targetId))
        : await deps.store.getTeam(input.targetId);
    if (!exists) throw new HttpError(404, { error: "not_found" });
    const salt = deps.reporterSalt ? await deps.reporterSalt() : deps.ipSalt;
    if (!salt) throw new HttpError(503, { error: "reports_unavailable" });
    const fresh = await deps.store.putReport({
      ...input,
      ipHash: sha256(`${salt}:${clientIp(event)}`),
      createdAt: now(),
    });
    if (
      input.targetType === "list" &&
      !seeds.has(input.targetId) &&
      (await deps.store.reportCount("list", input.targetId)) >= 3
    ) {
      await deps.store.hideList(input.targetId);
      await deps.publish.delete(`m/l/${input.targetId}.json`);
      await rebuildBrowse(input.targetId);
    }
    if (fresh) await deps.notifyReport?.(input);
    return json(204);
  }

  // ---- Helpers ---------------------------------------------------------------------------

  async function createUpload(event: Event) {
    await requireHuman(event);
    await enforceRate(event, "uploads");
    const { contentType } = parse(UploadInput, event);
    if (!deps.media) throw new HttpError(503, { error: "uploads_unavailable" });
    return json(201, await deps.media.begin(contentType));
  }

  async function prepareList(
    input: ListInput,
    id: string,
    current?: StoredList,
    onAuthorized?: () => Promise<void>,
  ) {
    const { uploadToken, baseVersion: _v, ...list } = input;
    const seedId = current?.seedId ?? list.seedId;
    const seed = seedId ? seeds.get(seedId) : undefined;
    if (seedId && !seed) throw new HttpError(400, { error: "unknown_seed" });
    if (
      list.characters.length > 150 &&
      (!seed ||
        list.characters.length > seed.characters.length ||
        list.characters.some((c) => !seed.characters.some((s) => s.id === c.id)))
    )
      throw new HttpError(400, { error: "too_many_characters" });
    const same = (a: ListInput["atlas"], b: ListInput["atlas"]) =>
      a.key === b.key && a.tile === b.tile && a.columns === b.columns && a.count === b.count;
    const seedAtlas = seed && { ...seed.atlas, key: `m/seeds/${seed.id}/${seed.atlas.src}` };
    if (!(
      (current && same(list.atlas, current.atlas)) ||
      (seedAtlas && same(list.atlas, seedAtlas))
    )) {
      if (!deps.media) throw new HttpError(503, { error: "uploads_unavailable" });
      if (list.atlas.count !== list.characters.length)
        throw new InvalidUpload("One tile is required for every character");
      list.atlas = await deps.media.finish(id, list.atlas, uploadToken, onAuthorized);
    }
    return {
      ...list,
      ...(seedId ? { seedId } : {}),
      ...(seed?.disclaimer ? { disclaimer: seed.disclaimer } : {}),
    };
  }

  /** True only during a load-test window, for a request carrying the window's secret. */
  async function loadtest(event: Event): Promise<boolean> {
    const given = header(event, "x-loadtest-token");
    if (!deps.loadtestToken || !given) return false;
    const secret = await deps.loadtestToken();
    // A short or missing secret never unlocks anything.
    return !!secret && secret.length >= 32 && tokenMatches(given, sha256(secret));
  }

  async function requireHuman(event: Event) {
    if (await loadtest(event)) return;
    const result = await deps.human(header(event, "x-turnstile-token"), clientIp(event));
    if (result === "unavailable") throw new HttpError(503, { error: "writes_unavailable" });
    if (result === "failed") throw new HttpError(403, { error: "human_check_failed" });
  }

  async function enforceRate(event: Event, kind: keyof typeof RATE_LIMITS) {
    if (await loadtest(event)) return;
    const salt = deps.reporterSalt ? await deps.reporterSalt() : deps.ipSalt;
    if (!salt) throw new HttpError(503, { error: "writes_unavailable" });
    const seconds = Math.floor(new Date(now()).getTime() / 1000);
    const window = Math.floor(seconds / 3600);
    const hash = sha256(`${salt}:${clientIp(event)}`);
    if (
      !(await deps.store.consumeRate(
        `RATE#${hash}#${window}#${kind}`,
        RATE_LIMITS[kind],
        (window + 2) * 3600,
      ))
    )
      throw new HttpError(
        429,
        { error: "rate_limited" },
        { "retry-after": String((window + 1) * 3600 - seconds) },
      );
  }

  async function ownedList(event: Event, id: string): Promise<StoredList> {
    const list = await deps.store.getList(id);
    if (!list || list.hidden) throw new HttpError(404, { error: "not_found" });
    const token = header(event, "authorization")?.replace(/^Bearer\s+/i, "");
    if (!token || !tokenMatches(token, list.editTokenHash))
      throw new HttpError(401, { error: "bad_edit_token" });
    return list;
  }

  /** A seed list or a stored one, in the shape teams snapshot from. */
  async function listFor(id: string): Promise<{
    title: string;
    version: number;
    characters: Character[];
    atlas: StoredTeam["atlas"];
    disclaimer?: string;
  }> {
    const seed = seeds.get(id);
    if (seed)
      return {
        title: seed.title,
        version: 0,
        characters: seed.characters,
        atlas: { ...seed.atlas, src: `/m/seeds/${seed.id}/${seed.atlas.src}` },
        disclaimer: seed.disclaimer,
      };
    const list = await deps.store.getList(id);
    if (!list || list.hidden) throw new HttpError(404, { error: "list_not_found" });
    const { key, ...atlas } = list.atlas;
    return { ...list, atlas: { src: `/${key}`, ...atlas } };
  }

  async function publishList(list: StoredList) {
    await deps.publish.put(`m/l/${list.id}.json`, listView(list), CACHE.list);
    // An update may have made a public list unlisted, so rebuild then too.
    if (list.visibility === "public" || list.version > 1) await rebuildBrowse(undefined, list);
  }

  /** Rebuild /m/browse/index.json from every public list. */
  async function rebuildBrowse(excludeId?: string, updated?: StoredList) {
    const lists = (await deps.store.publicLists()).filter((l) => l.id !== updated?.id);
    if (updated?.visibility === "public" && !updated.hidden) lists.push(updated);
    lists.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    await deps.publish.put(
      "m/browse/index.json",
      browseIndex(
        lists.filter((l) => l.id !== excludeId),
        now(),
      ),
      CACHE.browse,
    );
  }

  return handle;
}

function parse<T extends z.ZodType>(schema: T, event: Event): z.infer<T> {
  const raw = event.body ?? "";
  const body = event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
  if (Buffer.byteLength(body) > MAX_BODY) throw new HttpError(413, { error: "too_large" });
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new HttpError(400, { error: "invalid_json" });
  }
  const r = schema.safeParse(data);
  if (!r.success)
    throw new HttpError(400, {
      error: "invalid",
      issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  return r.data;
}

function header(event: Event, name: string): string | undefined {
  return event.headers?.[name] ?? undefined;
}

/**
 * The viewer's IP. CloudFront-Viewer-Address if forwarded, else the last X-Forwarded-For hop
 * (the one CloudFront adds). Never requestContext.sourceIp: that's CloudFront itself.
 */
export function clientIp(event: Event): string {
  const viewer = header(event, "cloudfront-viewer-address");
  if (viewer) return viewer.slice(0, viewer.lastIndexOf(":"));
  const xff = header(event, "x-forwarded-for");
  return xff?.split(",").pop()?.trim() || "unknown";
}

function usedIds(team: Team): Set<string> {
  const ids = new Set<string>();
  const add = (row: (string | null)[]) => row.forEach((id) => id && ids.add(id));
  Object.values(team.offense.depth).forEach(add);
  Object.values(team.defense.depth).forEach(add);
  Object.values(team.specialTeams ?? {}).forEach(add);
  add(Object.values(team.staff ?? {}));
  return ids;
}
