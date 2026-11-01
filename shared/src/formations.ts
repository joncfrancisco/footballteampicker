import type { Front, PositionId } from "./positions";

/**
 * Field coordinates are 0–100 on both axes: x across the field (0 = left sideline as the
 * viewer sees it), y downfield with the line of scrimmage at LOS_Y. Defense lines up at
 * y < LOS_Y, offense at y > LOS_Y. One yard is about 2 units deep and 1.9 units wide.
 */
export const LOS_Y = 50;

/**
 * A depth spot: `depth` is 1-based, so WR3 is { pos: "WR", depth: 3 }. `unit` is only set
 * when a slot fills from another unit than its formation's (baseball's pitcher).
 */
export type DepthRef = { pos: string; depth: number; unit?: string };

export type Slot = {
  /** Unique within the formation. */
  id: string;
  /** Alignment name shown on the field ("X", "Slot", "NB"). */
  label: string;
  ref: DepthRef;
  x: number;
  y: number;
};

export type Personnel = "00" | "10" | "11" | "12" | "13" | "21" | "22";
export type Package = "base" | "nickel" | "dime";
export type QbAlignment = "under" | "gun";

export type Formation = {
  id: string;
  /** The unit whose depth chart this formation views. */
  unit: string;
  name: string;
  /** Picker group ("11 personnel", "Base"). */
  group?: string;
  personnel?: Personnel;
  /** Only valid for this row variant of its unit (football's front). */
  variant?: string;
  package?: Package;
  /** One per player on the surface: 11 in football. */
  slots: Slot[];
  /** Offense: where the QB lines up by default, and moves for the other alignment if offered. */
  qb?: QbAlignment;
  altQb?: { moves: Record<string, { x: number; y: number }> };
};

const s = (
  id: string,
  label: string,
  pos: PositionId,
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

// ---- Offense ---------------------------------------------------------------------------

const LINE_Y = 53;
const OFF_LINE = (y = LINE_Y): Slot[] => [
  s("lt", "LT", "LT", 1, 38, y),
  s("lg", "LG", "LG", 1, 44, y),
  s("c", "C", "C", 1, 50, y),
  s("rg", "RG", "RG", 1, 56, y),
  s("rt", "RT", "RT", 1, 62, y),
];
const UNDER = { qb: s("qb", "QB", "QB", 1, 50, 57), rb: s("rb", "RB", "RB", 1, 50, 66) };
const GUN = { qb: s("qb", "QB", "QB", 1, 50, 62), rb: s("rb", "RB", "RB", 1, 57, 63) };
const TO_GUN = { qb: { x: GUN.qb.x, y: GUN.qb.y }, rb: { x: GUN.rb.x, y: GUN.rb.y } };
const TO_UNDER = { qb: { x: UNDER.qb.x, y: UNDER.qb.y }, rb: { x: UNDER.rb.x, y: UNDER.rb.y } };

const OFFENSE: Formation[] = [
  {
    id: "11-singleback",
    unit: "offense",
    name: "Singleback",
    personnel: "11",
    qb: "under",
    altQb: { moves: TO_GUN },
    slots: [
      ...OFF_LINE(),
      UNDER.qb,
      UNDER.rb,
      s("y", "Y", "TE", 1, 68, LINE_Y),
      s("x", "X", "WR", 1, 8, LINE_Y),
      s("z", "Z", "WR", 2, 90, 56),
      s("slot", "Slot", "WR", 3, 22, 56),
    ],
  },
  {
    id: "11-shotgun-trips",
    unit: "offense",
    name: "Shotgun Trips",
    personnel: "11",
    qb: "gun",
    altQb: { moves: TO_UNDER },
    slots: [
      ...OFF_LINE(),
      GUN.qb,
      { ...GUN.rb, x: 43 },
      s("y", "Y", "TE", 1, 68, LINE_Y),
      s("x", "X", "WR", 1, 8, LINE_Y),
      s("z", "Z", "WR", 2, 92, 56),
      s("slot", "Slot", "WR", 3, 80, 56),
    ],
  },
  {
    id: "12-ace",
    unit: "offense",
    name: "Singleback Ace",
    personnel: "12",
    qb: "under",
    altQb: { moves: TO_GUN },
    slots: [
      ...OFF_LINE(),
      UNDER.qb,
      UNDER.rb,
      s("y", "Y", "TE", 1, 68, LINE_Y),
      s("u", "U", "TE", 2, 32, LINE_Y),
      s("x", "X", "WR", 1, 8, LINE_Y),
      s("z", "Z", "WR", 2, 90, 56),
    ],
  },
  {
    id: "21-i-pro",
    unit: "offense",
    name: "I-Formation Pro",
    personnel: "21",
    qb: "under",
    slots: [
      ...OFF_LINE(),
      UNDER.qb,
      s("fb", "FB", "FB", 1, 50, 62),
      s("rb", "RB", "RB", 1, 50, 69),
      s("y", "Y", "TE", 1, 68, LINE_Y),
      s("x", "X", "WR", 1, 8, LINE_Y),
      s("z", "Z", "WR", 2, 90, 56),
    ],
  },
  {
    id: "22-i-tight",
    unit: "offense",
    name: "I-Formation Tight",
    personnel: "22",
    qb: "under",
    slots: [
      ...OFF_LINE(),
      UNDER.qb,
      s("fb", "FB", "FB", 1, 50, 62),
      s("rb", "RB", "RB", 1, 50, 69),
      s("y", "Y", "TE", 1, 68, LINE_Y),
      s("u", "U", "TE", 2, 32, LINE_Y),
      s("x", "X", "WR", 1, 8, LINE_Y),
    ],
  },
  {
    id: "13-jumbo",
    unit: "offense",
    name: "Jumbo",
    personnel: "13",
    qb: "under",
    slots: [
      ...OFF_LINE(),
      UNDER.qb,
      UNDER.rb,
      s("y", "Y", "TE", 1, 68, LINE_Y),
      s("u", "U", "TE", 2, 32, LINE_Y),
      s("wing", "Wing", "TE", 3, 73, 57),
      s("x", "X", "WR", 1, 8, LINE_Y),
    ],
  },
  {
    id: "10-spread",
    unit: "offense",
    name: "Shotgun Spread",
    personnel: "10",
    qb: "gun",
    altQb: { moves: TO_UNDER },
    slots: [
      ...OFF_LINE(),
      GUN.qb,
      GUN.rb,
      s("x", "X", "WR", 1, 8, LINE_Y),
      s("slot", "Slot", "WR", 3, 22, 56),
      s("z", "Z", "WR", 2, 92, 56),
      s("slot2", "Slot", "WR", 4, 78, 56),
    ],
  },
  {
    id: "00-empty",
    unit: "offense",
    name: "Empty",
    personnel: "00",
    qb: "gun",
    slots: [
      ...OFF_LINE(),
      GUN.qb,
      s("x", "X", "WR", 1, 8, LINE_Y),
      s("slot", "Slot", "WR", 3, 21, 56),
      s("z", "Z", "WR", 2, 92, 56),
      s("slot2", "Slot", "WR", 4, 80, 56),
      s("slot3", "Slot", "WR", 5, 70, 57),
    ],
  },
];

// ---- Defense ---------------------------------------------------------------------------

const DL_Y = 47;
const LB_Y = 40;
const CORNERS = [s("lcb", "LCB", "LCB", 1, 10, 45), s("rcb", "RCB", "RCB", 1, 90, 45)];
const SAFETIES = [s("ss", "SS", "SS", 1, 63, 32), s("fs", "FS", "FS", 1, 40, 25)];
const NICKEL = s("nb", "NB", "NB", 1, 78, 42);
const DIME = s("db", "DB", "DB", 1, 22, 42);

const FOUR_THREE_DL = [
  s("lde", "LDE", "LDE", 1, 34, DL_Y),
  s("ldt", "LDT", "LDT", 1, 46, DL_Y),
  s("rdt", "RDT", "RDT", 1, 53, DL_Y),
  s("rde", "RDE", "RDE", 1, 65, DL_Y),
];

const DEFENSE: Formation[] = [
  {
    id: "43-over",
    unit: "defense",
    name: "4-3 Over",
    variant: "4-3",
    package: "base",
    slots: [
      ...FOUR_THREE_DL,
      s("wlb", "WLB", "WLB", 1, 38, LB_Y),
      s("mlb", "MLB", "MLB", 1, 50, LB_Y),
      s("slb", "SLB", "SLB", 1, 62, LB_Y),
      ...CORNERS,
      ...SAFETIES,
    ],
  },
  {
    id: "43-bear",
    unit: "defense",
    name: "46 Bear",
    variant: "4-3",
    package: "base",
    slots: [
      s("lde", "LDE", "LDE", 1, 31, DL_Y),
      s("ldt", "LDT", "LDT", 1, 44, DL_Y),
      s("rdt", "RDT", "RDT", 1, 56, DL_Y),
      s("rde", "RDE", "RDE", 1, 69, DL_Y),
      s("wlb", "WLB", "WLB", 1, 37, LB_Y),
      s("mlb", "MLB", "MLB", 1, 48, 38),
      s("slb", "SLB", "SLB", 1, 75, 46),
      s("ss", "SS", "SS", 1, 59, 40),
      s("fs", "FS", "FS", 1, 50, 24),
      ...CORNERS,
    ],
  },
  {
    id: "43-nickel",
    unit: "defense",
    name: "4-2-5 Nickel",
    variant: "4-3",
    package: "nickel",
    slots: [
      ...FOUR_THREE_DL,
      s("wlb", "WLB", "WLB", 1, 43, LB_Y),
      s("mlb", "MLB", "MLB", 1, 56, LB_Y),
      NICKEL,
      ...CORNERS,
      ...SAFETIES,
    ],
  },
  {
    id: "43-dime",
    unit: "defense",
    name: "4-1-6 Dime",
    variant: "4-3",
    package: "dime",
    slots: [
      ...FOUR_THREE_DL,
      s("mlb", "MLB", "MLB", 1, 50, LB_Y),
      NICKEL,
      DIME,
      ...CORNERS,
      ...SAFETIES,
    ],
  },
  {
    id: "34-okie",
    unit: "defense",
    name: "3-4 Okie",
    variant: "3-4",
    package: "base",
    slots: [
      s("lde", "LDE", "LDE", 1, 40, DL_Y),
      s("nt", "NT", "NT", 1, 50, DL_Y),
      s("rde", "RDE", "RDE", 1, 60, DL_Y),
      s("lolb", "LOLB", "LOLB", 1, 28, 46),
      s("lilb", "LILB", "LILB", 1, 44, LB_Y),
      s("rilb", "RILB", "RILB", 1, 56, LB_Y),
      s("rolb", "ROLB", "ROLB", 1, 72, 46),
      ...CORNERS,
      ...SAFETIES,
    ],
  },
  {
    id: "34-nickel",
    unit: "defense",
    name: "2-4-5 Nickel",
    variant: "3-4",
    package: "nickel",
    slots: [
      s("lde", "LDE", "LDE", 1, 44, DL_Y),
      s("rde", "RDE", "RDE", 1, 56, DL_Y),
      s("lolb", "LOLB", "LOLB", 1, 31, 46),
      s("lilb", "LILB", "LILB", 1, 44, LB_Y),
      s("rilb", "RILB", "RILB", 1, 56, LB_Y),
      s("rolb", "ROLB", "ROLB", 1, 69, 46),
      NICKEL,
      ...CORNERS,
      ...SAFETIES,
    ],
  },
  {
    id: "34-dime",
    unit: "defense",
    name: "2-3-6 Dime",
    variant: "3-4",
    package: "dime",
    slots: [
      s("lde", "LDE", "LDE", 1, 44, DL_Y),
      s("rde", "RDE", "RDE", 1, 56, DL_Y),
      s("lolb", "LOLB", "LOLB", 1, 31, 46),
      s("lilb", "LILB", "LILB", 1, 50, LB_Y),
      s("rolb", "ROLB", "ROLB", 1, 69, 46),
      NICKEL,
      DIME,
      ...CORNERS,
      ...SAFETIES,
    ],
  },
];

const PACKAGES: Record<Package, string> = { base: "Base", nickel: "Nickel", dime: "Dime" };

export const FORMATIONS: readonly Formation[] = [...OFFENSE, ...DEFENSE].map((f) => ({
  ...f,
  group: f.personnel ? `${f.personnel} personnel` : PACKAGES[f.package!],
}));

export const DEFAULT_OFFENSE = "11-singleback";
export const DEFAULT_DEFENSE: Record<Front, string> = { "4-3": "43-over", "3-4": "34-okie" };

/** Picker label, e.g. "11 · Shotgun Trips". */
export function formationLabel(f: Formation): string {
  return f.personnel ? `${f.personnel} · ${f.name}` : f.name;
}

/** Slots with the QB toggle applied. */
export function slotsFor(f: Formation, qb: string | undefined): Slot[] {
  if (!f.altQb || !qb || qb === f.qb) return f.slots;
  return f.slots.map((slot) => ({ ...slot, ...f.altQb!.moves[slot.id] }));
}

/** "WR3" for { pos: "WR", depth: 3 }; a dash after rows ending in a digit ("PP1-3", "1B-1"). */
export function refLabel(ref: DepthRef): string {
  return `${ref.pos}${/\d$/.test(ref.pos) ? "-" : ""}${ref.depth}`;
}
