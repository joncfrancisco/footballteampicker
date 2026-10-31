import { DEFAULT_DEFENSE, DEFAULT_OFFENSE, type DepthRef, type QbAlignment } from "./formations";
import { rowsFor, type Front } from "./positions";

export type CharId = string;

/** Ordered rows; index 0 is the starter. Holes (null) are allowed. */
export type Depth = Record<string, (CharId | null)[]>;

export type Team = {
  title: string;
  listId: string;
  offense: { depth: Depth; formation: string; qb?: QbAlignment };
  defense: { front: Front; depth: Depth; formation: string };
};

export function emptyDepth(rows: Readonly<Record<string, number>>): Depth {
  return Object.fromEntries(Object.entries(rows).map(([pos, n]) => [pos, Array(n).fill(null)]));
}

export function newTeam(list: { id: string; ip: string }, front: Front = "4-3"): Team {
  return {
    title: `My ${list.ip} Team`,
    listId: list.id,
    offense: { depth: emptyDepth(rowsFor("offense")), formation: DEFAULT_OFFENSE },
    defense: {
      front,
      depth: emptyDepth(rowsFor("defense", front)),
      formation: DEFAULT_DEFENSE[front],
    },
  };
}

/** Who holds a depth spot (`ref.depth` is 1-based), or null. */
export function atRef(depth: Depth, ref: DepthRef): CharId | null {
  return depth[ref.pos]?.[ref.depth - 1] ?? null;
}
