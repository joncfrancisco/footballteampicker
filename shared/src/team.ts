import type { DepthRef, QbAlignment } from "./formations";
import type { Front, StaffRole } from "./positions";
import { defaultVariant, unitRows, type Rows, type SportDef } from "./sport";
import { DEFAULT_SPORT, sportById } from "./sports";

export type CharId = string;

/** Ordered rows; index 0 is the starter. Holes (null) are allowed. */
export type Depth = Record<string, (CharId | null)[]>;

/** One unit's part of the team: its depth chart and how it lines up. */
export type UnitState = {
  depth: Depth;
  /** The formation shown on the surface (units without formations have none). */
  formation?: string;
  /** Row variant, for units with more than one (football's front). */
  variant?: string;
  /** Alternate alignment the formation offers (football's QB "under" / "gun"). */
  align?: string;
};

/**
 * A team (#44): one sport, its units' depth charts and any optional sections the team turned
 * on. Staff are a section whose roles are rows one deep.
 */
export type Team = {
  schemaVersion: 2;
  sport: string;
  title: string;
  listId: string;
  units: Record<string, UnitState>;
  sections?: Record<string, Depth>;
};

/** The football-only shape every team had before #44. Published teams keep it forever. */
export type TeamV1 = {
  title: string;
  listId: string;
  offense: { depth: Depth; formation: string; qb?: QbAlignment };
  defense: { front: Front; depth: Depth; formation: string };
  specialTeams?: Depth;
  staff?: Partial<Record<StaffRole, CharId | null>>;
};

export function emptyDepth(rows: Rows): Depth {
  return Object.fromEntries(Object.entries(rows).map(([pos, n]) => [pos, Array(n).fill(null)]));
}

export function newTeam(
  list: { id: string; ip: string },
  sportId: string = DEFAULT_SPORT,
  variants: Record<string, string> = {},
): Team {
  const sport = sportById(sportId)!;
  return {
    schemaVersion: 2,
    sport: sport.id,
    title: `My ${list.ip} Team`,
    listId: list.id,
    units: Object.fromEntries(
      sport.units.map((u) => [u.id, emptyUnit(sport, u.id, variants[u.id])]),
    ),
  };
}

export function emptyUnit(sport: SportDef, unitId: string, variant?: string): UnitState {
  const unit = sport.units.find((u) => u.id === unitId)!;
  const v =
    unit.variants.length > 1 && unit.variants.some((x) => x.id === variant)
      ? variant
      : defaultVariant(unit);
  const formation = unit.defaultFormation?.[v ?? unit.variants[0]!.id];
  return {
    depth: emptyDepth(unitRows(unit, v)),
    ...(formation ? { formation } : {}),
    ...(v !== undefined ? { variant: v } : {}),
  };
}

/** Who holds a depth spot (`ref.depth` is 1-based), or null. */
export function atRef(depth: Depth, ref: DepthRef): CharId | null {
  return depth[ref.pos]?.[ref.depth - 1] ?? null;
}

/** A team in the current shape: v1 football teams (no `sport`) are converted. */
type V1Only = "offense" | "defense" | "specialTeams" | "staff";

export function upgradeTeam<T extends object>(team: T): Team & Omit<T, V1Only> {
  if ("sport" in team) return team as unknown as Team & Omit<T, V1Only>;
  const { offense, defense, specialTeams, staff, ...rest } = team as unknown as TeamV1;
  const sections: Record<string, Depth> = {};
  if (specialTeams) sections.specialTeams = specialTeams;
  if (staff)
    sections.staff = Object.fromEntries(Object.entries(staff).map(([r, id]) => [r, [id ?? null]]));
  return {
    ...rest,
    schemaVersion: 2,
    sport: "football",
    units: {
      offense: {
        depth: offense.depth,
        formation: offense.formation,
        ...(offense.qb ? { align: offense.qb } : {}),
      },
      defense: { depth: defense.depth, formation: defense.formation, variant: defense.front },
    },
    ...(Object.keys(sections).length ? { sections } : {}),
  } as unknown as Team & Omit<T, V1Only>;
}
