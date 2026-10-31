import { FORMATIONS, slotsFor } from "@ftp/shared";
import { describe, expect, it } from "vitest";
import { layoutSlots, type Placed } from "./layout";
import { SCALE, TILE, VIEW } from "./views";

// Narrowest supported phone (375px) inside the 16px gutters, and the facing layout at its
// minimum: 1100px less gutters, the 320px pool and the gap.
const PHONE = { width: 343, scale: SCALE.narrow, tile: TILE.narrow };
const DESKTOP = { width: 732, scale: SCALE.wide, tile: TILE.wide };

function overlaps(placed: Placed[], tile: { width: number; height: number }) {
  const bad: string[] = [];
  for (let i = 0; i < placed.length; i++)
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i]!;
      const b = placed[j]!;
      if (Math.abs(a.left - b.left) < tile.width && Math.abs(a.top - b.top) < tile.height)
        bad.push(`${a.id}/${b.id}`);
    }
  return bad;
}

describe.each(
  FORMATIONS.flatMap((f) =>
    (f.altQb ? [f.qb!, f.qb === "gun" ? "under" : "gun"] : [f.qb]).map((qb) => [
      `${f.id}${qb ? ` (${qb})` : ""}`,
      f,
      qb,
    ]),
  ) as [string, (typeof FORMATIONS)[number], "gun" | "under" | undefined][],
)("%s", (_name, f, qb) => {
  const away = f.side === "offense" ? 1 : -1;
  const slots = slotsFor(f, qb);

  it.each([
    ["phone", PHONE, f.side === "offense" ? VIEW.offense : VIEW.defense],
    ["desktop", DESKTOP, f.side === "offense" ? VIEW.faceOffense : VIEW.faceDefense],
  ] as const)("has no overlapping tiles on %s", (_size, size, view) => {
    const height = (view.yMax - view.yMin) * size.scale;
    const placed = layoutSlots({
      slots,
      ...view,
      width: size.width,
      height,
      tile: size.tile,
      away,
    });
    expect(overlaps(placed, size.tile)).toEqual([]);
    for (const p of placed) {
      expect(p.left).toBeGreaterThanOrEqual(size.tile.width / 2);
      expect(p.left).toBeLessThanOrEqual(size.width - size.tile.width / 2);
    }
  });
});

describe("layoutSlots", () => {
  it("keeps exact coordinates when nothing collides", () => {
    const [p] = layoutSlots({
      slots: [{ id: "a", x: 50, y: 50 }],
      yMin: 0,
      yMax: 100,
      away: 1,
      width: 1000,
      height: 600,
      tile: TILE.wide,
    });
    expect(p).toEqual({ id: "a", left: 500, top: 300 });
  });
});
