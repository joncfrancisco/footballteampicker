import {
  LOS_Y,
  findFormation,
  slotsFor,
  type Formation,
  type Slot,
  type SportDef,
  type SurfaceId,
  type Team,
} from "@ftp/shared";
import { SCALE, VIEW } from "./views";

/**
 * Playing surfaces (#44). A surface knows how to draw itself and which panes of it the
 * builder shows; formations stay in 0–100 coordinates on both axes, x across and y along the
 * direction of play, whatever the sport.
 */

/** Surface markings in surface units. Circle radii are in x units and stay round. */
export type Mark =
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; accent?: boolean }
  | { kind: "rect"; x: number; y: number; w: number; h: number; fill?: boolean }
  | { kind: "circle"; cx: number; cy: number; r: number; fill?: boolean }
  /** Part of a circle, angles in degrees clockwise from +x (so 90 points down the surface). */
  | { kind: "arc"; cx: number; cy: number; r: number; from: number; to: number }
  | { kind: "polygon"; points: [number, number][]; fill?: boolean };

/** One drawn piece of surface: a unit's formation over rows yMin–yMax. */
export type Pane = {
  unit: string;
  label: string;
  formation: Formation;
  slots: Slot[];
  yMin: number;
  yMax: number;
  /** Which way is away from the play for tiles that must step back: +1 down, -1 up. */
  away: 1 | -1;
};

export type SurfaceDef = {
  id: SurfaceId;
  /** "Field", "Pitch": the view toggle and export labels. */
  noun: string;
  /** Height over width of the whole 0–100 surface; none means it stretches (the gridiron). */
  aspect?: number;
  /** CSS background on screen, and the colours the PNG export paints with. */
  background: string;
  paint: { bg: string; line: string; fill: string; accent: string };
  marks(pane: { yMin: number; yMax: number }): Mark[];
  /** Pixel height of a pane `width` wide. */
  height(pane: Pane, width: number, narrow: boolean): number;
  /** Panes on a phone (as tabs if more than one) or a single desktop column. */
  panes(sport: SportDef, team: Team): Pane[];
  /** Panes drawn together on a wide screen, top to bottom, if the surface does that. */
  facing?(sport: SportDef, team: Team): Pane[];
  /** Tighter rows for a single-pane export, if any. */
  exportView?(unit: string): { yMin: number; yMax: number };
};

/** One pane per unit that has a formation, showing rows yMin–yMax of the surface. */
function wholePanes(away: 1 | -1, view = { yMin: 0, yMax: 100 }) {
  return (sport: SportDef, team: Team): Pane[] =>
    sport.units.flatMap((u) => {
      const state = team.units[u.id];
      const formation = findFormation(sport, state?.formation);
      if (!state || !formation) return [];
      return [
        {
          unit: u.id,
          label: u.name,
          formation,
          slots: slotsFor(formation, state.align),
          ...view,
          away,
        },
      ];
    });
}

/** Height of a pane on a surface with a fixed aspect, kept within a usable range. */
function aspectHeight(aspect: number) {
  return (pane: Pane, width: number) =>
    Math.round(Math.min(760, width * aspect * ((pane.yMax - pane.yMin) / 100)));
}

// ---- Gridiron --------------------------------------------------------------------------

const footballPane = (
  sport: SportDef,
  team: Team,
  unit: "offense" | "defense",
  view: { yMin: number; yMax: number },
): Pane => {
  const state = team.units[unit]!;
  const formation = findFormation(sport, state.formation)!;
  return {
    unit,
    label: unit === "offense" ? "Offense" : "Defense",
    formation,
    slots: slotsFor(formation, state.align),
    ...view,
    away: unit === "offense" ? 1 : -1,
  };
};

const GRIDIRON: SurfaceDef = {
  id: "gridiron",
  noun: "Field",
  background: "var(--turf)",
  paint: {
    bg: "#2f7a3e",
    line: "rgba(255,255,255,0.55)",
    fill: "rgba(255,255,255,0.18)",
    accent: "#5aa9ff",
  },
  // Yard lines every 5 yards (10 units) from the line of scrimmage, hash marks every yard.
  marks({ yMin, yMax }) {
    const out: Mark[] = [];
    for (let y = LOS_Y - 50; y <= LOS_Y + 50; y += 10)
      if (y > yMin && y < yMax) out.push({ kind: "line", x1: 0, y1: y, x2: 100, y2: y });
    for (let y = Math.ceil(yMin / 2) * 2; y < yMax; y += 2)
      for (const x of [0.5, 44.3, 55.7, 99.5])
        out.push({ kind: "line", x1: x - 0.6, y1: y, x2: x + 0.6, y2: y });
    if (LOS_Y >= yMin && LOS_Y <= yMax)
      out.push({ kind: "line", x1: 0, y1: LOS_Y, x2: 100, y2: LOS_Y, accent: true });
    return out;
  },
  height: (pane, _width, narrow) =>
    Math.round((pane.yMax - pane.yMin) * (narrow ? SCALE.narrow : SCALE.wide)),
  panes: (sport, team) => [
    footballPane(sport, team, "offense", VIEW.offense),
    footballPane(sport, team, "defense", VIEW.defense),
  ],
  // Facing each other on a wide screen, the two fields meet at the line of scrimmage.
  facing: (sport, team) => [
    footballPane(sport, team, "defense", VIEW.faceDefense),
    footballPane(sport, team, "offense", VIEW.faceOffense),
  ],
  exportView: (unit) => (unit === "offense" ? { yMin: 47, yMax: 71 } : { yMin: 21, yMax: 51 }),
};

// ---- Pitch -----------------------------------------------------------------------------

/**
 * Soccer, own goal at the bottom. 100 units across is the 68 m width and 100 along is the
 * 105 m length, so 1 m is 1.47 units across and 0.95 along.
 */
const PITCH_ASPECT = 1.3;
const mx = (m: number) => (m / 68) * 100;
const my = (m: number) => (m / 105) * 100;

function penaltyEnd(goalY: number, dir: 1 | -1): Mark[] {
  const box = { w: mx(40.32), d: my(16.5) };
  const six = { w: mx(18.32), d: my(5.5) };
  const spotY = goalY - dir * my(11);
  const edge = goalY - dir * box.d;
  return [
    { kind: "rect", x: 50 - box.w / 2, y: Math.min(goalY, edge), w: box.w, h: box.d },
    {
      kind: "rect",
      x: 50 - six.w / 2,
      y: Math.min(goalY, goalY - dir * six.d),
      w: six.w,
      h: six.d,
    },
    { kind: "circle", cx: 50, cy: spotY, r: 0.6, fill: true },
    // The D: the part of the 9.15 m circle round the spot outside the box.
    dir === 1
      ? { kind: "arc", cx: 50, cy: spotY, r: mx(9.15), from: 210, to: 330 }
      : { kind: "arc", cx: 50, cy: spotY, r: mx(9.15), from: 30, to: 150 },
    {
      kind: "rect",
      x: 50 - mx(7.32) / 2,
      y: dir === 1 ? goalY : goalY - 1.5,
      w: mx(7.32),
      h: 1.5,
    },
  ];
}

const PITCH: SurfaceDef = {
  id: "pitch",
  noun: "Pitch",
  aspect: PITCH_ASPECT,
  background: "var(--turf)",
  paint: GRIDIRON.paint,
  marks: () => [
    { kind: "rect", x: 2, y: 2, w: 96, h: 96 },
    { kind: "line", x1: 2, y1: 50, x2: 98, y2: 50 },
    { kind: "circle", cx: 50, cy: 50, r: mx(9.15) },
    { kind: "circle", cx: 50, cy: 50, r: 0.6, fill: true },
    ...penaltyEnd(98, 1),
    ...penaltyEnd(2, -1),
  ],
  height: aspectHeight(PITCH_ASPECT),
  // From just short of the far box to the own goal line: the whole shape of the team.
  panes: wholePanes(1, { yMin: 14, yMax: 100 }),
};

export const SURFACES: Record<SurfaceId, SurfaceDef | undefined> = {
  gridiron: GRIDIRON,
  pitch: PITCH,
  court: undefined,
  rink: undefined,
  diamond: undefined,
};

export function surfaceOf(sport: SportDef): SurfaceDef {
  const surface = SURFACES[sport.surface];
  if (!surface) throw new Error(`No ${sport.surface} surface`);
  return surface;
}
