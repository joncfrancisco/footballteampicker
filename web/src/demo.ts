import { newTeam, setSection, type Team } from "@ftp/shared";
import type { LoadedList } from "./lists";

/**
 * `?fill=demo` (add `&sections=1` for special teams and staff): a full team from the list in
 * order, for screenshots, export checks and manual testing. Nobody plays both sides, and
 * staff are characters not used anywhere else.
 */
export function demoTeam(list: LoadedList, opts: { sections?: boolean } = {}): Team {
  const ids = list.characters.map((c) => c.id);
  let next = 0;
  const fill = (depth: Record<string, (string | null)[]>) =>
    Object.fromEntries(
      Object.entries(depth).map(([pos, row]) => [pos, row.map(() => ids[next++] ?? null)]),
    );
  let team = newTeam(list);
  team = {
    ...team,
    offense: { ...team.offense, depth: fill(team.offense.depth) },
    defense: { ...team.defense, depth: fill(team.defense.depth) },
  };
  if (!opts.sections) return team;
  team = setSection(setSection(team, "specialTeams", true), "staff", true);
  // Special teams reuse offensive players (they play on top of a spot); staff are new faces.
  const offense = Object.values(team.offense.depth).flat();
  const specialTeams = Object.fromEntries(
    Object.entries(team.specialTeams!).map(([pos, row], i) => [
      pos,
      row.map((_, j) => offense[i * 2 + j] ?? null),
    ]),
  );
  const staff = Object.fromEntries(Object.keys(team.staff!).map((r) => [r, ids[next++] ?? null]));
  return { ...team, specialTeams, staff: staff as Team["staff"] };
}
