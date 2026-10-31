import type { Spot } from "@ftp/shared";

/** dnd-kit ids for depth spots: "spot:offense:WR:3" (index is 0-based). */
export function spotId(spot: Spot): string {
  return `spot:${spot.side}:${spot.pos}:${spot.index}`;
}

export function parseSpotId(id: string | number): Spot | null {
  const [kind, side, pos, index] = String(id).split(":");
  if (kind !== "spot" || (side !== "offense" && side !== "defense") || !pos) return null;
  return { side, pos, index: Number(index) };
}

/** "WR4" for a spot. */
export function spotLabel(spot: Spot): string {
  return `${spot.pos}${spot.index + 1}`;
}
