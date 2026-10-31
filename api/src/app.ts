import {
  CharacterList,
  ListInput,
  ReportInput,
  TeamInput,
  teamErrors,
  type Character,
  type Team,
} from "@ftp/shared";
import type { z } from "zod";
import type { HumanCheck } from "./human";
import { newEditToken, newId, sha256, tokenMatches } from "./ids";
import { CACHE, type Publisher } from "./publish";
import {
  VersionConflict,
  type CharacterSnapshot,
  type Store,
  type StoredList,
  type StoredTeam,
} from "./store";
import type { Event, Result } from "./types";

export type Deps = {
  store: Store;
  publish: Publisher;
  human: HumanCheck;
  /** Built-in lists (`demo-*`), bundled rather than stored. */
  seeds: CharacterList[];
  now?: () => Date;
  /** Salt for hashing reporter IPs. */
  ipSalt?: string;
};

const MAX_BODY = 64 * 1024;

class HttpError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
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

  const routes: [string, RegExp, (e: Event, m: RegExpMatchArray) => Promise<Result>][] = [
    ["GET", /^\/api\/health$/, async () => json(200, { ok: true })],
    ["POST", /^\/api\/lists$/, createList],
    ["PUT", /^\/api\/lists\/([A-Za-z0-9]{10})$/, updateList],
    ["DELETE", /^\/api\/lists\/([A-Za-z0-9]{10})$/, deleteList],
    ["POST", /^\/api\/teams$/, createTeam],
    ["POST", /^\/api\/reports$/, createReport],
    // #10: presigned atlas uploads.
    ["POST", /^\/api\/uploads$/, async () => json(501, { error: "not_implemented" })],
  ];

  async function handle(event: Event): Promise<Result> {
    const method = event.requestContext.http.method;
    const path = event.rawPath;
    try {
      for (const [m, re, fn] of routes) {
        const match = path.match(re);
        if (match && m === method) return await fn(event, match);
      }
      return json(404, { error: "not_found" });
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, e.body);
      console.error(
        JSON.stringify({ msg: "unhandled", error: String(e), stack: (e as Error).stack }),
      );
      return json(500, { error: "internal" });
    }
  }

  // ---- Routes ----------------------------------------------------------------------------

  async function createList(event: Event) {
    await requireHuman(event);
    const input = parse(ListInput, event);
    const id = newId();
    const editToken = newEditToken();
    const at = now();
    const list: StoredList = {
      ...input,
      id,
      editTokenHash: sha256(editToken),
      version: 1,
      createdAt: at,
      updatedAt: at,
    };
    await deps.store.putList(list);
    await publishList(list);
    return json(201, { id, editToken, version: 1 });
  }

  async function updateList(event: Event, [, id]: RegExpMatchArray) {
    await requireHuman(event);
    const current = await ownedList(event, id!);
    const input = parse(ListInput, event);
    const list: StoredList = {
      ...current,
      ...input,
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
    return json(200, { id, version: list.version });
  }

  async function deleteList(event: Event, [, id]: RegExpMatchArray) {
    const current = await ownedList(event, id!);
    await deps.store.deleteList(current.id);
    // Saved teams keep their own snapshot, so their links keep working.
    await deps.publish.delete(`m/l/${id}.json`);
    if (current.visibility === "public") await rebuildBrowse();
    return json(204);
  }

  async function createTeam(event: Event) {
    await requireHuman(event);
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
    const input = parse(ReportInput, event);
    await deps.store.putReport({
      ...input,
      ipHash: sha256(`${deps.ipSalt ?? ""}${clientIp(event)}`),
      createdAt: now(),
    });
    return json(204);
  }

  // ---- Helpers ---------------------------------------------------------------------------

  async function requireHuman(event: Event) {
    const result = await deps.human(header(event, "x-turnstile-token"), clientIp(event));
    if (result === "unavailable") throw new HttpError(503, { error: "writes_unavailable" });
    if (result === "failed") throw new HttpError(403, { error: "human_check_failed" });
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
    const { editTokenHash: _h, hidden: _hidden, atlas, ...view } = list;
    await deps.publish.put(
      `m/l/${list.id}.json`,
      { ...view, atlas: publicAtlas(atlas) },
      CACHE.list,
    );
    // An update may have made a public list unlisted, so rebuild then too.
    if (list.visibility === "public" || list.version > 1) await rebuildBrowse();
  }

  /** Rebuild /m/browse/index.json from every public list. */
  async function rebuildBrowse() {
    const lists = await deps.store.publicLists();
    await deps.publish.put(
      "m/browse/index.json",
      {
        updatedAt: now(),
        lists: lists.map((l) => ({
          id: l.id,
          title: l.title,
          ip: l.ip,
          description: l.description,
          tags: l.tags,
          count: l.characters.length,
          twoWayCount: l.characters.filter((c) => c.twoWay).length,
          createdAt: l.createdAt,
          atlas: publicAtlas(l.atlas),
          cover: l.characters.slice(0, 4).map((c) => c.atlasIndex),
          updatedAt: l.updatedAt,
        })),
      },
      CACHE.browse,
    );
  }

  return handle;
}

function publicAtlas({ key, ...atlas }: StoredList["atlas"]) {
  return { ...atlas, src: `/${key}` };
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
