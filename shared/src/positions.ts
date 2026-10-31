/**
 * Depth chart rows (#21). A team is a depth chart; formations are views onto it.
 * Sizes are how deep each row goes: WR has WR1–WR6, most rows are two deep.
 */
export const OFFENSE_ROWS = {
  QB: 3,
  RB: 3,
  FB: 2,
  WR: 6,
  TE: 3,
  LT: 2,
  LG: 2,
  C: 2,
  RG: 2,
  RT: 2,
} as const;

export const FRONTS = ["4-3", "3-4"] as const;
export type Front = (typeof FRONTS)[number];

export const DEFENSE_ROWS = {
  "4-3": {
    LDE: 2,
    LDT: 2,
    RDT: 2,
    RDE: 2,
    WLB: 2,
    MLB: 2,
    SLB: 2,
    LCB: 2,
    RCB: 2,
    NB: 2,
    SS: 2,
    FS: 2,
    DB: 1,
  },
  "3-4": {
    LDE: 2,
    NT: 2,
    RDE: 2,
    LOLB: 2,
    LILB: 2,
    RILB: 2,
    ROLB: 2,
    LCB: 2,
    RCB: 2,
    NB: 2,
    SS: 2,
    FS: 2,
    DB: 1,
  },
} as const;

export type OffensePosition = keyof typeof OFFENSE_ROWS;
export type DefensePosition =
  keyof (typeof DEFENSE_ROWS)["4-3"] | keyof (typeof DEFENSE_ROWS)["3-4"];
export type PositionId = OffensePosition | DefensePosition;

export type Side = "offense" | "defense";

/** Rows (and their depth) that exist for one side of the ball. */
export function rowsFor(side: "offense"): Readonly<Record<OffensePosition, number>>;
export function rowsFor(side: "defense", front: Front): Readonly<Record<string, number>>;
export function rowsFor(side: Side, front: Front = "4-3"): Readonly<Record<string, number>> {
  return side === "offense" ? OFFENSE_ROWS : DEFENSE_ROWS[front];
}
