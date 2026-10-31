import { CharacterList, type Character } from "@ftp/shared";

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
  atlasUrl: string;
  byId: ReadonlyMap<string, Character>;
};

export const SEED_LISTS: LoadedList[] = Object.entries(lists).map(([path, raw]) => {
  const list = CharacterList.parse(raw);
  const dir = path.slice(0, path.lastIndexOf("/"));
  const atlasUrl = atlases[`${dir}/${list.atlas.src}`];
  if (!atlasUrl) throw new Error(`missing atlas ${list.atlas.src} for ${path}`);
  return { ...list, atlasUrl, byId: new Map(list.characters.map((c) => [c.id, c])) };
});
