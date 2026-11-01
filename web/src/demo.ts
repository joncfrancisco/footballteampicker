import { newTeam, setSection, sportOf, type Depth, type Team } from "@ftp/shared";
import type { LoadedList } from "./lists";

/**
 * `?fill=demo` (add `&sections=1` for every optional section): a full team from the list in
 * order, for screenshots, export checks and manual testing. Nobody plays in two units, and
 * staff are characters not used anywhere else.
 */
export function demoTeam(
  list: LoadedList,
  opts: { sections?: boolean; sport?: string } = {},
): Team {
  const ids = list.characters.map((c) => c.id);
  let next = 0;
  const fill = (depth: Depth): Depth =>
    Object.fromEntries(
      Object.entries(depth).map(([pos, row]) => [pos, row.map(() => ids[next++] ?? null)]),
    );
  let team = newTeam(list, opts.sport);
  const sport = sportOf(team);
  team = {
    ...team,
    units: Object.fromEntries(
      Object.entries(team.units).map(([id, u]) => [id, { ...u, depth: fill(u.depth) }]),
    ),
  };
  if (!opts.sections) return team;
  team = sport.sections.reduce((t, s) => setSection(t, s.id, true), team);
  // Situational sections reuse first-unit players (they play on top of a spot); staff are new.
  const players = Object.values(team.units[sport.units[0]!.id]!.depth).flat();
  const sections = Object.fromEntries(
    sport.sections.map((s) => {
      // Each row starts at least two players on, so a one-deep row skips one (K, P, LS...).
      let start = 0;
      const depth = Object.fromEntries(
        Object.entries(team.sections![s.id]!).map(([pos, row]) => {
          const from = start;
          start += Math.max(2, row.length);
          return [
            pos,
            row.map((_, j) =>
              s.kind === "staff" ? (ids[next++] ?? null) : (players[from + j] ?? null),
            ),
          ];
        }),
      );
      return [s.id, depth];
    }),
  );
  return { ...team, sections };
}
