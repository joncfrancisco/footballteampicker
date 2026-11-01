import type { Formation, Slot } from "../formations";
import type { SportDef } from "../sport";

/**
 * Soccer (#62). One squad of fixed position rows, 26 deep in all (a matchday pool); the
 * second string is the bench. Pitch coordinates: x across (0 = the viewer's left), y up the
 * pitch with the team's own goal at the bottom (y = 100), attacking up.
 */
export const SOCCER_ROWS = {
  GK: 2,
  RB: 2,
  CB: 5,
  LB: 2,
  DM: 2,
  CM: 4,
  AM: 2,
  RW: 2,
  LW: 2,
  ST: 3,
} as const;

const s = (id: string, label: string, pos: string, depth: number, x: number, y: number): Slot => ({
  id,
  label,
  ref: { pos, depth },
  x,
  y,
});

const GK = s("gk", "GK", "GK", 1, 50, 91);
const BACK_FOUR = [
  s("rb", "RB", "RB", 1, 85, 74),
  s("rcb", "CB", "CB", 1, 62, 78),
  s("lcb", "CB", "CB", 2, 38, 78),
  s("lb", "LB", "LB", 1, 15, 74),
];
const BACK_THREE = [
  s("rcb", "CB", "CB", 1, 72, 77),
  s("cb", "CB", "CB", 3, 50, 80),
  s("lcb", "CB", "CB", 2, 28, 77),
];
const TWO_UP = [s("rst", "ST", "ST", 1, 60, 30), s("lst", "ST", "ST", 2, 40, 30)];

const f = (id: string, name: string, group: string, slots: Slot[]): Formation => ({
  id: `soccer-${id}`,
  unit: "squad",
  name,
  group,
  slots: [GK, ...slots],
});

export const SOCCER_FORMATIONS: readonly Formation[] = [
  f("442", "4-4-2", "Back four", [
    ...BACK_FOUR,
    s("rm", "RM", "RW", 1, 85, 54),
    s("rcm", "CM", "CM", 1, 60, 57),
    s("lcm", "CM", "CM", 2, 40, 57),
    s("lm", "LM", "LW", 1, 15, 54),
    ...TWO_UP,
  ]),
  f("433", "4-3-3", "Back four", [
    ...BACK_FOUR,
    s("dm", "DM", "DM", 1, 50, 63),
    s("rcm", "CM", "CM", 1, 67, 53),
    s("lcm", "CM", "CM", 2, 33, 53),
    s("rw", "RW", "RW", 1, 83, 35),
    s("st", "ST", "ST", 1, 50, 29),
    s("lw", "LW", "LW", 1, 17, 35),
  ]),
  f("4231", "4-2-3-1", "Back four", [
    ...BACK_FOUR,
    s("rdm", "DM", "DM", 1, 61, 63),
    s("ldm", "DM", "DM", 2, 39, 63),
    s("rw", "RW", "RW", 1, 82, 43),
    s("am", "AM", "AM", 1, 50, 45),
    s("lw", "LW", "LW", 1, 18, 43),
    s("st", "ST", "ST", 1, 50, 27),
  ]),
  f("352", "3-5-2", "Back three", [
    ...BACK_THREE,
    s("rwb", "RWB", "RB", 1, 88, 57),
    s("dm", "DM", "DM", 1, 50, 63),
    s("rcm", "CM", "CM", 1, 66, 51),
    s("lcm", "CM", "CM", 2, 34, 51),
    s("lwb", "LWB", "LB", 1, 12, 57),
    ...TWO_UP,
  ]),
  f("532", "5-3-2", "Back five", [
    s("rwb", "RWB", "RB", 1, 88, 69),
    s("rcb", "CB", "CB", 1, 69, 77),
    s("cb", "CB", "CB", 3, 50, 80),
    s("lcb", "CB", "CB", 2, 31, 77),
    s("lwb", "LWB", "LB", 1, 12, 69),
    s("rcm", "CM", "CM", 1, 68, 54),
    s("dm", "DM", "DM", 1, 50, 60),
    s("lcm", "CM", "CM", 2, 32, 54),
    ...TWO_UP,
  ]),
  f("343", "3-4-3", "Back three", [
    ...BACK_THREE,
    s("rwb", "RWB", "RB", 1, 88, 56),
    s("rcm", "CM", "CM", 1, 60, 58),
    s("lcm", "CM", "CM", 2, 40, 58),
    s("lwb", "LWB", "LB", 1, 12, 56),
    s("rw", "RW", "RW", 1, 80, 35),
    s("st", "ST", "ST", 1, 50, 29),
    s("lw", "LW", "LW", 1, 20, 35),
  ]),
];

export const SOCCER: SportDef = {
  id: "soccer",
  name: "Soccer",
  surface: "pitch",
  units: [
    {
      id: "squad",
      name: "Squad",
      short: "XI",
      variants: [{ id: "base", name: "Squad", rows: SOCCER_ROWS }],
      defaultFormation: { base: "soccer-433" },
    },
  ],
  sections: [
    {
      id: "setPieces",
      name: "Set pieces",
      short: "SP",
      kind: "situational",
      rows: { CAPT: 1, PEN: 1, FK: 1, LC: 1, RC: 1 },
      titles: {
        CAPT: "Captain",
        PEN: "Penalties",
        FK: "Free kicks",
        LC: "Left corners",
        RC: "Right corners",
      },
      // One player can be captain and take every set piece.
      maxPerCharacter: 5,
    },
    {
      id: "staff",
      name: "Staff",
      short: "Staff",
      kind: "staff",
      rows: { MGR: 1, AST: 1, GKC: 1, SD: 1 },
      titles: {
        MGR: "Manager",
        AST: "Assistant manager",
        GKC: "Goalkeeping coach",
        SD: "Sporting director",
      },
    },
  ],
  formations: SOCCER_FORMATIONS,
};
