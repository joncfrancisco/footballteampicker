import {
  BrowseIndex,
  CharacterList,
  PublishedList,
  type Character,
  type ListSummary,
} from "@ftp/shared";

/** Seed rosters bundled with the app (seed/<name>/list.json + its atlas). */
const lists = import.meta.glob<unknown>("../../seed/*/list.json", {
  eager: true,
  import: "default",
});
const atlases = import.meta.glob<string>("../../seed/*/atlas-*.webp", {
  eager: true,
  query: "?url",
  import: "default",
});

export type LoadedList = CharacterList & {
  seedId?: string;
  visibility?: "public" | "unlisted";
  version: number;
  atlasUrl: string;
  byId: ReadonlyMap<string, Character>;
};

export const SEED_LISTS: LoadedList[] = Object.entries(lists).map(([path, raw]) => {
  const list = CharacterList.parse(raw);
  const dir = path.slice(0, path.lastIndexOf("/"));
  const atlasUrl = atlases[`${dir}/${list.atlas.src}`];
  if (!atlasUrl) throw new Error(`missing atlas ${list.atlas.src} for ${path}`);
  return { ...list, version: 0, atlasUrl, byId: new Map(list.characters.map((c) => [c.id, c])) };
});

export class MissingList extends Error {}

/** Public media URLs must stay on this origin, under the media behaviour. */
export function mediaUrl(src: string): string {
  if (!/^\/m\/[A-Za-z0-9_./-]+$/.test(src) || src.includes(".."))
    throw new Error("Invalid media URL");
  return src;
}

export async function loadList(id: string, signal?: AbortSignal): Promise<LoadedList> {
  const seed = SEED_LISTS.find((l) => l.id === id);
  if (seed) return seed;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new MissingList();
  const response = await fetch(`/m/l/${id}.json`, { signal });
  if (response.status === 404 || response.status === 403) throw new MissingList();
  if (!response.ok) throw new Error("Could not load this list. Please try again.");
  const list = PublishedList.parse(await response.json());
  if (list.id !== id) throw new Error("Invalid list");
  return {
    ...list,
    atlasUrl: mediaUrl(list.atlas.src),
    byId: new Map(list.characters.map((c) => [c.id, c])),
  };
}

export function summarize(list: LoadedList): ListSummary {
  return {
    ...list,
    atlas: { ...list.atlas, src: list.atlasUrl },
    count: list.characters.length,
    twoWayCount: list.characters.filter((c) => c.twoWay).length,
    cover: list.characters.slice(0, 4).map((c) => c.atlasIndex),
    createdAt: "",
    updatedAt: "",
  };
}

export async function loadBrowse(signal?: AbortSignal): Promise<ListSummary[]> {
  const response = await fetch("/m/browse/index.json", { signal });
  // The object does not exist until the first public list is saved.
  if (response.status === 404) return [];
  if (!response.ok) throw new Error("Community lists could not be loaded. Please try again.");
  return BrowseIndex.parse(await response.json()).lists.map((list) => ({
    ...list,
    atlas: { ...list.atlas, src: mediaUrl(list.atlas.src) },
  }));
}
