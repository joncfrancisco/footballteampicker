import type { Formation, Slot } from "../formations";
import type { SportDef } from "../sport";

/**
 * Hockey (#64). Four forward lines, three defence pairs and two goalies (20, a dressed
 * lineup). Rink coordinates: the team's half, centre line at the top and its own net at the
 * bottom, attacking up.
 */
export const HOCKEY_ROWS = { LW: 4, C: 4, RW: 4, LD: 3, RD: 3, G: 2 } as const;

const ORDINAL = ["1st", "2nd", "3rd", "4th"];

const line = (n: number): Formation => {
  const pair = Math.min(n, 3);
  const s = (
    id: string,
    label: string,
    pos: string,
    depth: number,
    x: number,
    y: number,
  ): Slot => ({
    id,
    label,
    ref: { pos, depth },
    x,
    y,
  });
  return {
    id: `hockey-line${n}`,
    unit: "lineup",
    name: `${ORDINAL[n - 1]} line, ${ORDINAL[pair - 1]} pair`,
    group: "Even strength",
    slots: [
      s("lw", "LW", "LW", n, 20, 30),
      s("c", "C", "C", n, 50, 26),
      s("rw", "RW", "RW", n, 80, 30),
      s("ld", "LD", "LD", pair, 30, 56),
      s("rd", "RD", "RD", pair, 70, 56),
      s("g", "G", "G", 1, 50, 84),
    ],
  };
};

const GOALIES = { unit: "lineup", pos: ["G"], label: "a goalie" } as const;

export const HOCKEY: SportDef = {
  id: "hockey",
  name: "Hockey",
  surface: "rink",
  units: [
    {
      id: "lineup",
      name: "Lineup",
      short: "L",
      variants: [{ id: "base", name: "Lineup", rows: HOCKEY_ROWS }],
      defaultFormation: { base: "hockey-line1" },
    },
  ],
  sections: [
    {
      // Five open skater spots per unit: 4F/1D or 3F/2D, never a goalie.
      id: "powerPlay",
      name: "Power play",
      short: "PP",
      kind: "situational",
      rows: { PP1: 5, PP2: 5 },
      excludes: GOALIES,
    },
    {
      id: "penaltyKill",
      name: "Penalty kill",
      short: "PK",
      kind: "situational",
      rows: { PK1: 4, PK2: 4 },
      excludes: GOALIES,
    },
    {
      id: "staff",
      name: "Staff",
      short: "Staff",
      kind: "staff",
      rows: { HC: 1, AC: 1, GC: 1, GM: 1 },
      titles: {
        HC: "Head coach",
        AC: "Assistant coach",
        GC: "Goaltending coach",
        GM: "General manager",
      },
    },
  ],
  formations: [1, 2, 3, 4].map(line),
};
