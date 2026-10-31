import { PublishedTeam, type Team } from "@ftp/shared";
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

/** Keep the offense spot when a former two-way player can now only play one side. */
export function remixTeam(
  saved: PublishedTeam,
  list: LoadedList,
): { team: Team; notices: string[] } {
  const team: Team = structuredClone({
    title: saved.title,
    listId: saved.listId,
    offense: saved.offense,
    defense: saved.defense,
    ...(saved.specialTeams ? { specialTeams: saved.specialTeams } : {}),
    ...(saved.staff ? { staff: saved.staff as Team["staff"] } : {}),
  });
  const notices: string[] = [];
  const missing = new Set<string>();
  const offense = new Set(Object.values(team.offense.depth).flat().filter(Boolean));
  for (const [side, depth] of Object.entries({
    offense: team.offense.depth,
    defense: team.defense.depth,
    specialTeams: team.specialTeams,
    staff: team.staff && Object.fromEntries(Object.entries(team.staff).map(([r, id]) => [r, [id]])),
  })) {
    if (!depth) continue;
    for (const row of Object.values(depth))
      for (let i = 0; i < row.length; i++) {
        const id = row[i];
        if (!id) continue;
        const c = list.byId.get(id);
        if (!c) {
          row[i] = null;
          missing.add(saved.characters[id]?.name ?? id);
        } else if (side === "defense" && offense.has(id) && !c.twoWay) {
          row[i] = null;
          notices.push(`${c.name} is no longer two-way. Kept offense and cleared defense.`);
        }
      }
    if (side === "staff" && team.staff)
      for (const [role, row] of Object.entries(depth))
        team.staff[role as keyof typeof team.staff] = row[0] ?? null;
  }
  if (missing.size)
    notices.unshift(
      `Missing from the current list: ${[...missing].join(", ")}. Their spots are empty.`,
    );
  return { team, notices };
}
