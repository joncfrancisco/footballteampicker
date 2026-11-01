import type { Formation, Slot } from "../formations";
import type { SportDef } from "../sport";

/**
 * Baseball (#65). MLB's 26: 13 pitchers and 13 position players (nine starters with the DH,
 * four on the bench). Pitchers and hitters are separate units, so only a two-way player can
 * do both. Diamond coordinates: home plate at the bottom, centre field at the top.
 */
export const PITCHER_ROWS = { SP: 5, RP: 7, CL: 1 } as const;

const STARTERS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const;
const one = (positions: readonly string[]) => Object.fromEntries(positions.map((p) => [p, 1]));
export const HITTER_ROWS = { ...one(STARTERS), DH: 1, BN: 4 } as const;
export const HITTER_ROWS_NO_DH = { ...one(STARTERS), BN: 4 } as const;

const s = (id: string, pos: string, x: number, y: number, unit?: string): Slot => ({
  id,
  label: id === "p" ? "P" : pos,
  ref: unit ? { pos, depth: 1, unit } : { pos, depth: 1 },
  x,
  y,
});

const DEFENSE: Formation = {
  id: "baseball-defense",
  unit: "hitters",
  name: "Defensive alignment",
  group: "Defense",
  slots: [
    // The day's starter takes the mound.
    s("p", "SP", 50, 70, "pitchers"),
    s("c", "C", 50, 93),
    s("1b", "1B", 73, 64),
    s("2b", "2B", 61, 47),
    s("ss", "SS", 39, 47),
    s("3b", "3B", 27, 64),
    s("lf", "LF", 19, 27),
    s("cf", "CF", 50, 16),
    s("rf", "RF", 81, 27),
  ],
};

/** Batting order 1–9 of the starters; with the DH off the pitcher (SP1) bats instead. */
const order = (dh: boolean) =>
  ["CF", "SS", "1B", dh ? "DH" : "P", "3B", "RF", "LF", "2B", "C"].map((id) => ({
    id,
    label: id,
    ref: id === "P" ? { pos: "SP", depth: 1, unit: "pitchers" } : { pos: id, depth: 1 },
  }));

export const BASEBALL: SportDef = {
  id: "baseball",
  name: "Baseball",
  surface: "diamond",
  units: [
    {
      id: "pitchers",
      name: "Pitchers",
      short: "P",
      variants: [{ id: "base", name: "Pitchers", rows: PITCHER_ROWS }],
    },
    {
      id: "hitters",
      name: "Position players",
      short: "H",
      // Universal DH by default; turning it off puts the pitcher in the batting order.
      variantLabel: "DH",
      variants: [
        { id: "dh", name: "On", rows: HITTER_ROWS },
        { id: "no-dh", name: "Off", rows: HITTER_ROWS_NO_DH },
      ],
      defaultFormation: { dh: DEFENSE.id, "no-dh": DEFENSE.id },
      battingOrder: { dh: order(true), "no-dh": order(false) },
    },
  ],
  sections: [
    {
      id: "staff",
      name: "Staff",
      short: "Staff",
      kind: "staff",
      rows: { MGR: 1, BC: 1, PC: 1, HC: 1, GM: 1 },
      titles: {
        MGR: "Manager",
        BC: "Bench coach",
        PC: "Pitching coach",
        HC: "Hitting coach",
        GM: "General manager",
      },
    },
  ],
  formations: [DEFENSE],
};
