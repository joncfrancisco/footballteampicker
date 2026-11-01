import { SPORTS, newTeam, slotsFor } from "@ftp/shared";
import { describe, expect, it } from "vitest";
import { layoutSlots } from "./layout";
import { surfaceOf } from "./surfaces";
import { TILE } from "./views";

// The narrowest phone (375px less gutters) and the desktop builder column.
const SIZES = [
  { name: "phone", width: 343, tile: TILE.narrow, narrow: true },
  { name: "desktop", width: 732, tile: TILE.wide, narrow: false },
] as const;

/** Every formation of every sport other than football (its own tests cover it) fits. */
const cases = SPORTS.filter((s) => s.id !== "football").flatMap((sport) =>
  sport.formations.map((f) => [`${sport.id} ${f.id}`, sport, f] as const),
);

describe.each(cases)("%s", (_name, sport, f) => {
  it.each(SIZES)("has no overlapping tiles on $name", ({ width, tile, narrow }) => {
    const surface = surfaceOf(sport);
    const team = newTeam({ id: "l", ip: "X" }, sport.id, f.variant ? { [f.unit]: f.variant } : {});
    team.units[f.unit] = { ...team.units[f.unit]!, formation: f.id };
    const pane = surface.panes(sport, team).find((p) => p.unit === f.unit)!;
    expect(pane.formation.id).toBe(f.id);
    const height = surface.height(pane, width, narrow);
    const placed = layoutSlots({ ...pane, slots: slotsFor(f, undefined), width, height, tile });
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!;
        const b = placed[j]!;
        const apart =
          Math.abs(a.left - b.left) >= tile.width || Math.abs(a.top - b.top) >= tile.height;
        expect(apart, `${a.id}/${b.id}`).toBe(true);
      }
    for (const p of placed) {
      expect(p.top).toBeGreaterThanOrEqual(tile.height / 2 - 0.01);
      expect(p.top).toBeLessThanOrEqual(height - tile.height / 2 + 0.01);
    }
  });
});

describe("surfaces", () => {
  it("exist for every registered sport, with a pane per unit that has formations", () => {
    for (const sport of SPORTS) {
      const team = newTeam({ id: "l", ip: "X" }, sport.id);
      const units = sport.units
        .filter((u) => sport.formations.some((f) => f.unit === u.id))
        .map((u) => u.id);
      expect(
        surfaceOf(sport)
          .panes(sport, team)
          .map((p) => p.unit)
          .sort(),
      ).toEqual(units.sort());
    }
  });
});
