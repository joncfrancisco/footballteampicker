import { type Team } from "@ftp/shared";
import type { LoadedList } from "./lists";

/**
 * `?fill=demo`: fill every depth spot from the list in order, so screenshots and manual
 * checks show portraits before drag and drop (#7) exists. Nobody plays both sides.
 */
export function fillDemo(team: Team, list: LoadedList): Team {
  const ids = list.characters.map((c) => c.id);
  let next = 0;
  const fill = (depth: Team["offense"]["depth"]) =>
    Object.fromEntries(
      Object.entries(depth).map(([pos, row]) => [pos, row.map(() => ids[next++] ?? null)]),
    );
  return {
    ...team,
    offense: { ...team.offense, depth: fill(team.offense.depth) },
    defense: { ...team.defense, depth: fill(team.defense.depth) },
  };
}
