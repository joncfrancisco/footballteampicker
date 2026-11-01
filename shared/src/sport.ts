import type { DepthRef, Formation } from "./formations";

/**
 * A sport is data (#44): the units that make up its depth chart, the formations that view
 * them, its optional sections and the playing surface. The builder, the export and the API's
 * validation all read it, so a new sport needs no new code paths.
 */
export type Rows = Readonly<Record<string, number>>;

/** A row set a unit can switch between (football's 4-3 / 3-4 front, baseball's DH). */
export type Variant = { id: string; name: string; rows: Rows };

export type UnitDef = {
  id: string;
  /** "Offense". Lowercased in rule messages ("already has a spot on offense"). */
  name: string;
  /** Pool marker for players in this unit ("O"). */
  short: string;
  /** The first is the default. Most units have exactly one. */
  variants: readonly Variant[];
  /** What the variant picker is called ("Front"). */
  variantLabel?: string;
  /** Rows that carry over on a variant switch besides same-named ones: from → to → { pos: pos }. */
  variantMap?: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>>;
  /** Default formation per variant id; units without formations are depth-chart only. */
  defaultFormation?: Readonly<Record<string, string>>;
  /**
   * An ordering of some spots, per variant (baseball's batting order), in its default order.
   * Teams store the ids in their order; a `ref.unit` reaches another unit (the pitcher).
   */
  battingOrder?: Readonly<Record<string, readonly OrderSpot[]>>;
};

export type OrderSpot = { id: string; label: string; ref: DepthRef };

export type SectionDef = {
  id: string;
  /** "Special teams". Lowercased in rule messages. Staff sections are always id "staff". */
  name: string;
  /** Pool marker ("ST", "Staff"). */
  short: string;
  /**
   * Situational sections reuse players already on the team, on top of their unit spots.
   * Staff never play.
   */
  kind: "situational" | "staff";
  rows: Rows;
  /** Long names for rows ("Head coach"); staff roles and one-deep roles show these. */
  titles?: Readonly<Record<string, string>>;
  /** Spots one character may hold in this section. Default 1. */
  maxPerCharacter?: number;
  /** Two rows one character may hold together despite the limit (football's KR + PR). */
  pairs?: readonly (readonly [string, string])[];
  /** Characters on these rows can't be in this section (hockey: goalies). */
  excludes?: { unit: string; pos: readonly string[]; label: string };
};

export type SurfaceId = "gridiron" | "pitch" | "court" | "rink" | "diamond";

export type SportDef = {
  id: string;
  name: string;
  surface: SurfaceId;
  units: readonly UnitDef[];
  sections: readonly SectionDef[];
  formations: readonly Formation[];
};

export function unitDef(sport: SportDef, id: string): UnitDef | undefined {
  return sport.units.find((u) => u.id === id);
}

export function sectionDef(sport: SportDef, id: string): SectionDef | undefined {
  return sport.sections.find((s) => s.id === id);
}

/** A unit's rows for a variant (the default variant if none or unknown). */
export function unitRows(unit: UnitDef, variant?: string): Rows {
  return (unit.variants.find((v) => v.id === variant) ?? unit.variants[0]!).rows;
}

export function defaultVariant(unit: UnitDef): string | undefined {
  return unit.variants.length > 1 ? unit.variants[0]!.id : undefined;
}

/** Formations for one unit and variant. */
export function unitFormations(sport: SportDef, unit: string, variant?: string): Formation[] {
  return sport.formations.filter(
    (f) => f.unit === unit && (f.variant === undefined || f.variant === variant),
  );
}

export function findFormation(sport: SportDef, id: string | undefined): Formation | undefined {
  return id === undefined ? undefined : sport.formations.find((f) => f.id === id);
}

/** A unit's batting order spots for a variant, in the team's order (or the default). */
export function orderSpots(
  unit: UnitDef,
  variant?: string,
  order?: readonly string[],
): OrderSpot[] {
  const spots = unit.battingOrder?.[variant ?? unit.variants[0]!.id] ?? [];
  if (!order) return [...spots];
  return order.flatMap((id) => spots.filter((s) => s.id === id));
}
