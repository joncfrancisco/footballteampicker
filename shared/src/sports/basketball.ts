import type { Formation, Slot } from "../formations";
import type { SportDef } from "../sport";

/**
 * Basketball (#63). Traditional positions 1–5, three deep (15, an NBA roster). Court
 * coordinates: the offensive half court, basket at the top, attacking up.
 */
export const BASKETBALL_ROWS = { PG: 3, SG: 3, SF: 3, PF: 3, C: 3 } as const;

const five = (id: string, name: string, depth: number): Formation => {
  const s = (slot: string, label: string, pos: string, x: number, y: number): Slot => ({
    id: slot,
    label,
    ref: { pos, depth },
    x,
    y,
  });
  return {
    id: `basketball-${id}`,
    unit: "roster",
    name,
    group: "Lineups",
    slots: [
      s("pg", "1 · PG", "PG", 50, 76),
      s("sg", "2 · SG", "SG", 84, 52),
      s("sf", "3 · SF", "SF", 16, 52),
      s("pf", "4 · PF", "PF", 30, 26),
      s("c", "5 · C", "C", 66, 22),
    ],
  };
};

export const BASKETBALL: SportDef = {
  id: "basketball",
  name: "Basketball",
  surface: "court",
  units: [
    {
      id: "roster",
      name: "Roster",
      short: "R",
      variants: [{ id: "base", name: "Roster", rows: BASKETBALL_ROWS }],
      defaultFormation: { base: "basketball-starters" },
    },
  ],
  sections: [
    {
      // Positionless: any five from the roster, one spot each.
      id: "closing",
      name: "Closing five",
      short: "CL",
      kind: "situational",
      rows: { CL: 5 },
    },
    {
      id: "staff",
      name: "Staff",
      short: "Staff",
      kind: "staff",
      rows: { HC: 1, AC: 1, GM: 1 },
      titles: { HC: "Head coach", AC: "Assistant coach", GM: "General manager" },
    },
  ],
  formations: [five("starters", "Starting five", 1), five("second", "Second unit", 2)],
};
