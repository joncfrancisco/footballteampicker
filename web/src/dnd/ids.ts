import type { Spot } from "@ftp/shared";

const SIDES = new Set<string>(["offense", "defense", "specialTeams", "staff"]);

/** dnd-kit ids for depth spots: "spot:offense:WR:3" (index is 0-based). */
export function spotId(spot: Spot): string {
  return `spot:${spot.side}:${spot.pos}:${spot.index}`;
}

export function parseSpotId(id: string | number): Spot | null {
  const [kind, side, pos, index] = String(id).split(":");
  if (kind !== "spot" || !side || !SIDES.has(side) || !pos) return null;
  return { side: side as Spot["side"], pos, index: Number(index) };
}

/** Pool cards drag as "pool:<characterId>". */
export function poolId(charId: string): string {
  return `pool:${charId}`;
}

export function parsePoolId(id: string | number): string | null {
  const s = String(id);
  return s.startsWith("pool:") ? s.slice(5) : null;
}

/** The pool itself is a drop target: dropping a placed character there removes them. */
export const POOL_DROP = "pool-drop";

/** "WR4" for a spot; staff roles are just the role ("HC"). */
export function spotLabel(spot: Spot): string {
  return spot.side === "staff" ? spot.pos : `${spot.pos}${spot.index + 1}`;
}

/** "offense", "special teams", "staff". */
export function sideName(side: Spot["side"]): string {
  return side === "specialTeams" ? "special teams" : side;
}
