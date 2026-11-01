import { PublishedTeam, sideName, sportOf, type Team } from "@ftp/shared";
import { mediaUrl, type LoadedList } from "./lists";

export async function loadTeam(id: string, signal?: AbortSignal): Promise<PublishedTeam> {
  const response = await fetch(`/m/t/${id}.json`, { signal });
  if (!response.ok)
    throw new Error(
      response.status === 404 || response.status === 403
        ? "missing"
        : "Team could not be loaded. Please try again.",
    );
  const team = PublishedTeam.parse(await response.json());
  if (team.id !== id) throw new Error("Invalid team");
  mediaUrl(team.atlas.src);
  return team;
}

export function snapshotList(saved: PublishedTeam): LoadedList {
  const characters = Object.entries(saved.characters).map(([id, c]) => ({ ...c, id, tags: [] }));
  return {
    id: saved.listId,
    title: saved.listTitle,
    ip: saved.listTitle,
    description: "",
    tags: [],
    disclaimer: saved.disclaimer,
    version: saved.listVersion,
    atlas: saved.atlas,
    atlasUrl: mediaUrl(saved.atlas.src),
    characters,
    byId: new Map(characters.map((c) => [c.id, c])),
  };
}

/** The team part of a published team, without its snapshot. */
export function teamOf(saved: PublishedTeam): Team {
  return structuredClone({
    schemaVersion: 2,
    sport: saved.sport,
    title: saved.title,
    listId: saved.listId,
    units: saved.units,
    ...(saved.sections ? { sections: saved.sections } : {}),
  });
}

/**
 * Remix against the current list: characters it no longer has leave their spots, and a
 * former two-way player keeps their first unit's spot (offense) and leaves the others.
 */
export function remixTeam(
  saved: PublishedTeam,
  list: LoadedList,
): { team: Team; notices: string[] } {
  const team = teamOf(saved);
  const sport = sportOf(team);
  const notices: string[] = [];
  const missing = new Set<string>();
  const firstUnit = new Map<string, string>();
  const sides = [
    ...sport.units.map((u) => [u.id, team.units[u.id]?.depth] as const),
    ...sport.sections.map((s) => [s.id, team.sections?.[s.id]] as const),
  ];
  for (const [side, depth] of sides) {
    if (!depth) continue;
    const isUnit = sport.units.some((u) => u.id === side);
    for (const row of Object.values(depth))
      for (let i = 0; i < row.length; i++) {
        const id = row[i];
        if (!id) continue;
        const c = list.byId.get(id);
        if (!c) {
          row[i] = null;
          missing.add(saved.characters[id]?.name ?? id);
        } else if (isUnit && firstUnit.has(id) && firstUnit.get(id) !== side && !c.twoWay) {
          row[i] = null;
          notices.push(
            `${c.name} is no longer two-way. Kept ${sideName(sport, firstUnit.get(id)!)} and cleared ${sideName(sport, side)}.`,
          );
        } else if (isUnit && !firstUnit.has(id)) firstUnit.set(id, side);
      }
  }
  if (missing.size)
    notices.unshift(
      `Missing from the current list: ${[...missing].join(", ")}. Their spots are empty.`,
    );
  return { team, notices };
}
