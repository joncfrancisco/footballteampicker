import type { DepthRef } from "./formations";
import { sectionDef, unitDef, unitRows, type SectionDef, type SportDef } from "./sport";
import { sportOf } from "./sports";
import { emptyDepth, emptyUnit, type CharId, type Depth, type Team } from "./team";

/**
 * The lineup rules, shared by the builder (#7, #21) and the API's team validation (#9), and
 * driven by the team's sport (#44). Every edit goes through here and either returns the new
 * team or a reason it was refused.
 *
 * - One spot per unit per character. Holding spots in two units takes the two-way flag
 *   (football's offense and defense, baseball's pitchers and hitters).
 * - Situational sections (special teams, power play, set pieces...) reuse players on top of
 *   their unit spots, with a per-section limit.
 * - Staff never play.
 */

/** A unit or section id. */
export type TeamSide = string;
/** A place on the team. Staff roles are rows one deep: { side: "staff", pos: "HC", index: 0 }. */
export type Spot = { side: TeamSide; pos: string; index: number };
export type Roster = { get(id: CharId): { name: string; twoWay: boolean } | undefined };

export type Result = { ok: true; team: Team; notice?: string } | { ok: false; reason: string };

type Kind = "unit" | "situational" | "staff";

/** Every unit and section of the team's sport, in order. */
export function sidesOf(sport: SportDef): TeamSide[] {
  return [...sport.units.map((u) => u.id), ...sport.sections.map((s) => s.id)];
}

function kindOf(sport: SportDef, side: TeamSide): Kind | undefined {
  if (unitDef(sport, side)) return "unit";
  return sectionDef(sport, side)?.kind;
}

/** "offense", "special teams", "staff". */
export function sideName(sport: SportDef, side: TeamSide): string {
  return (unitDef(sport, side) ?? sectionDef(sport, side))?.name.toLowerCase() ?? side;
}

/** A side's depth rows, or undefined if it's an optional section that's off. */
export function depthOf(team: Team, side: TeamSide): Depth | undefined {
  return team.units[side]?.depth ?? team.sections?.[side];
}

export function spotRef(spot: Spot): DepthRef {
  return { pos: spot.pos, depth: spot.index + 1 };
}

export function at(team: Team, spot: Spot): CharId | null {
  return depthOf(team, spot.side)?.[spot.pos]?.[spot.index] ?? null;
}

/** Every spot a character holds. */
export function spotsOf(team: Team, id: CharId): Spot[] {
  return sidesOf(sportOf(team)).flatMap((side) =>
    Object.entries(depthOf(team, side) ?? {}).flatMap(([pos, row]) =>
      row.flatMap((c, index) => (c === id ? [{ side, pos, index }] : [])),
    ),
  );
}

function withDepth(team: Team, side: TeamSide, depth: Depth): Team {
  if (team.units[side])
    return { ...team, units: { ...team.units, [side]: { ...team.units[side], depth } } };
  return { ...team, sections: { ...team.sections, [side]: depth } };
}

function exists(team: Team, spot: Spot): boolean {
  const row = depthOf(team, spot.side)?.[spot.pos];
  return !!row && spot.index >= 0 && spot.index < row.length;
}

function set(team: Team, spot: Spot, id: CharId | null): Team {
  const depth = { ...depthOf(team, spot.side)! };
  const row = [...depth[spot.pos]!];
  row[spot.index] = id;
  depth[spot.pos] = row;
  return withDepth(team, spot.side, depth);
}

/** Whether `rows` (a character's spots in one section) are within the section's limit. */
function withinLimit(section: SectionDef, rows: string[]): boolean {
  if (rows.length <= (section.maxPerCharacter ?? 1)) return true;
  const sorted = [...rows].sort();
  return (
    sorted.length === 2 && !!section.pairs?.some((p) => [...p].sort().join() === sorted.join())
  );
}

/** Rule violations for the whole team, as human-readable reasons. Empty means valid. */
export function violations(team: Team, roster: Roster): string[] {
  const sport = sportOf(team);
  const out: string[] = [];
  const spots = new Map<CharId, Spot[]>();
  for (const side of sidesOf(sport))
    for (const [pos, row] of Object.entries(depthOf(team, side) ?? {}))
      row.forEach((id, index) => {
        if (id === null) return;
        if (!roster.get(id)) out.push(`Unknown character "${id}"`);
        else spots.set(id, [...(spots.get(id) ?? []), { side, pos, index }]);
      });

  for (const [id, held] of spots) {
    const name = roster.get(id)!.name;
    const on = (side: TeamSide) => held.filter((s) => s.side === side);
    const units = sport.units.filter((u) => on(u.id).length);
    for (const u of units)
      if (on(u.id).length > 1) out.push(`${name} already has a spot on ${u.name.toLowerCase()}`);
    if (units.length > 1 && !roster.get(id)!.twoWay) out.push(`${name} isn't a two-way player`);
    const playing = held.some((s) => kindOf(sport, s.side) !== "staff");
    for (const section of sport.sections) {
      const mine = on(section.id);
      if (!mine.length) continue;
      if (section.kind === "staff") {
        if (mine.length > 1) out.push(`${name} already has a staff role`);
        if (playing) out.push(`${name} is on staff and can't play`);
        continue;
      }
      if (
        !withinLimit(
          section,
          mine.map((s) => s.pos),
        )
      )
        out.push(`${name} already has a ${section.name.toLowerCase()} spot`);
      const ex = section.excludes;
      if (ex && on(ex.unit).some((s) => ex.pos.includes(s.pos)))
        out.push(`${name} is ${ex.label} and can't play ${section.name.toLowerCase()}`);
    }
  }
  return out;
}

/** Shape check: units and sections match the sport, and rows match each one's template. */
export function shapeErrors(team: Team): string[] {
  const sport = sportOf(team);
  const out: string[] = [];
  const check = (name: string, depth: Depth, rows: Readonly<Record<string, number>>) => {
    for (const [pos, n] of Object.entries(rows))
      if (depth[pos]?.length !== n) out.push(`${name} ${pos} must have ${n} spots`);
    for (const pos of Object.keys(depth)) if (!(pos in rows)) out.push(`${name} has no ${pos} row`);
  };
  for (const u of sport.units) {
    const state = team.units[u.id];
    const name = u.name.toLowerCase();
    if (!state) {
      out.push(`Missing ${name}`);
      continue;
    }
    if (u.variants.length > 1 && !u.variants.some((v) => v.id === state.variant))
      out.push(`Unknown ${name} ${u.variantLabel?.toLowerCase() ?? "variant"} "${state.variant}"`);
    if (u.variants.length === 1 && state.variant !== undefined)
      out.push(`${u.name} has no variants`);
    check(name, state.depth, unitRows(u, state.variant));
  }
  for (const id of Object.keys(team.units))
    if (!unitDef(sport, id)) out.push(`${sport.name} has no ${id} unit`);
  for (const [id, depth] of Object.entries(team.sections ?? {})) {
    const s = sectionDef(sport, id);
    if (!s) out.push(`${sport.name} has no ${id} section`);
    else check(s.name.toLowerCase(), depth, s.rows);
  }
  return out;
}

/** Apply `next` only if the edit introduced no new rule violations. */
function commit(before: Team, next: Team, roster: Roster, notice?: string): Result {
  const already = new Set(violations(before, roster));
  const fresh = violations(next, roster).find((v) => !already.has(v));
  if (fresh) return { ok: false, reason: fresh };
  return notice ? { ok: true, team: next, notice } : { ok: true, team: next };
}

/**
 * Put a character from the pool into a spot. Whoever was there goes back to the pool.
 * - Units: if they already play in that unit, this is a move from that spot instead.
 * - Situational sections: on top of any unit spot, up to the section's limit (then it's a
 *   move within the section).
 * - Staff: staff don't play, so a player named to staff leaves the roster (with a notice); a
 *   staff member can't be put in a player spot.
 */
export function place(team: Team, roster: Roster, id: CharId, to: Spot): Result {
  const c = roster.get(id);
  if (!c) return { ok: false, reason: `Unknown character "${id}"` };
  if (!exists(team, to)) return { ok: false, reason: `No ${to.pos}${to.index + 1} spot` };
  const sport = sportOf(team);
  const kind = kindOf(sport, to.side)!;
  const held = spotsOf(team, id);
  const same = held.filter((s) => s.side === to.side);

  if (kind === "staff") {
    if (same.length) return move(team, roster, same[0]!, to);
    const playing = held.filter((s) => kindOf(sport, s.side) !== "staff");
    const next = set(
      playing.reduce((t, s) => set(t, s, null), team),
      to,
      id,
    );
    return commit(
      team,
      next,
      roster,
      playing.length ? `${c.name} moved to staff and off the roster` : undefined,
    );
  }
  if (held.some((s) => kindOf(sport, s.side) === "staff"))
    return { ok: false, reason: `${c.name} is on staff and can't play` };

  if (kind === "situational") {
    const section = sectionDef(sport, to.side)!;
    const samePos = same.find((s) => s.pos === to.pos);
    if (samePos) return move(team, roster, samePos, to);
    if (same.length && !withinLimit(section, [...same.map((s) => s.pos), to.pos]))
      return move(team, roster, same[0]!, to);
    return commit(team, set(team, to, id), roster);
  }

  if (same.length) return move(team, roster, same[0]!, to);
  const otherUnit = held.some((s) => kindOf(sport, s.side) === "unit");
  if (otherUnit && !c.twoWay) return { ok: false, reason: `${c.name} isn't a two-way player` };
  return commit(team, set(team, to, id), roster);
}

/**
 * Move whoever is in `from` to `to`. Within one row this reorders (everyone between shifts
 * down a spot, so promoting WR4 to WR2 makes the old WR2 the WR3). Between unit spots, or
 * within a section, it swaps. Onto a section from elsewhere it works like a placement
 * (situational sections are on top of a player's spot; staff leave the roster). Staff can't
 * move onto a player spot.
 */
export function move(team: Team, roster: Roster, from: Spot, to: Spot): Result {
  if (!exists(team, from) || !exists(team, to)) return { ok: false, reason: "No such spot" };
  const id = at(team, from);
  if (id === null) return { ok: false, reason: "Nobody to move" };
  if (from.side === to.side && from.pos === to.pos) {
    if (from.index === to.index) return { ok: true, team };
    const depth = { ...depthOf(team, from.side)! };
    const row = [...depth[from.pos]!];
    row.splice(from.index, 1);
    row.splice(to.index, 0, id);
    depth[from.pos] = row;
    return { ok: true, team: withDepth(team, from.side, depth) };
  }
  const sport = sportOf(team);
  const fromKind = kindOf(sport, from.side);
  const toKind = kindOf(sport, to.side);
  if (fromKind === "staff" && toKind !== "staff")
    return { ok: false, reason: `${roster.get(id)?.name ?? id} is on staff and can't play` };
  if (to.side !== from.side && (toKind !== "unit" || fromKind === "situational"))
    return place(team, roster, id, to);
  const other = at(team, to);
  return commit(team, set(set(team, from, other), to, id), roster);
}

/** Send whoever is in a spot back to the pool. */
export function remove(team: Team, spot: Spot): Team {
  return exists(team, spot) ? set(team, spot, null) : team;
}

/**
 * Change a unit's row variant (football's front). Rows in both variants keep their players,
 * plus the sport's mapped rows (LDT ↔ NT...). Anyone left over goes to the pool and is
 * reported, e.g. "2 players moved to the pool". The formation resets to the variant's default.
 */
export function switchVariant(
  team: Team,
  unitId: string,
  variant: string,
): { team: Team; moved: CharId[] } {
  const sport = sportOf(team);
  const unit = unitDef(sport, unitId);
  const state = team.units[unitId];
  if (!unit || !state || !unit.variants.some((v) => v.id === variant)) return { team, moved: [] };
  const from = state.variant;
  if (from === variant) return { team, moved: [] };
  const map = (from && unit.variantMap?.[from]?.[variant]) || {};
  const target = emptyDepth(unitRows(unit, variant));
  const moved: CharId[] = [];
  for (const [pos, row] of Object.entries(state.depth)) {
    const dest = pos in target ? pos : map[pos];
    row.forEach((id, i) => {
      if (id === null) return;
      if (dest && i < target[dest]!.length) target[dest]![i] = id;
      else moved.push(id);
    });
  }
  const fresh = emptyUnit(sport, unitId, variant);
  return {
    team: {
      ...team,
      units: { ...team.units, [unitId]: { ...state, ...fresh, depth: target } },
    },
    moved,
  };
}

export function movedNotice(moved: CharId[]): string | undefined {
  if (!moved.length) return undefined;
  return `${moved.length} ${moved.length === 1 ? "player" : "players"} moved to the pool`;
}

/** Where each character is on the team, for pool markers and the "unused" filter. */
export function usage(team: Team): Map<CharId, Set<TeamSide>> {
  const out = new Map<CharId, Set<TeamSide>>();
  for (const side of sidesOf(sportOf(team)))
    for (const row of Object.values(depthOf(team, side) ?? {}))
      for (const id of row) if (id !== null) out.set(id, (out.get(id) ?? new Set()).add(side));
  return out;
}

export function clearSide(team: Team, side: TeamSide): Team {
  const depth = depthOf(team, side);
  if (!depth) return team;
  return withDepth(
    team,
    side,
    Object.fromEntries(Object.entries(depth).map(([pos, row]) => [pos, row.map(() => null)])),
  );
}

/** Turn an optional section on (empty) or off (removed from the team entirely). */
export function setSection(team: Team, section: string, on: boolean): Team {
  const def = sectionDef(sportOf(team), section);
  if (!def || on === (team.sections?.[section] !== undefined)) return team;
  if (!on) {
    const { [section]: _removed, ...rest } = team.sections ?? {};
    if (Object.keys(rest).length) return { ...team, sections: rest };
    const { sections: _none, ...bare } = team;
    return bare;
  }
  return { ...team, sections: { ...team.sections, [section]: emptyDepth(def.rows) } };
}

/** How many spots on a side are filled (e.g. to confirm before turning a section off). */
export function filledCount(team: Team, side: TeamSide): number {
  return Object.values(depthOf(team, side) ?? {})
    .flat()
    .filter((id) => id !== null).length;
}

/**
 * Fill every empty unit spot, in unit order, from characters who aren't on the team yet, in
 * `order`. Nobody is put in two units, so the result is valid whatever the two-way flags
 * say. Sections are left alone.
 */
export function autoFill(team: Team, order: CharId[]): Team {
  const used = usage(team);
  const queue = order.filter((id) => !used.has(id));
  let next = team;
  for (const unit of sportOf(team).units) {
    const depth = Object.fromEntries(
      Object.entries(next.units[unit.id]!.depth).map(([pos, row]) => [
        pos,
        row.map((id) => id ?? queue.shift() ?? null),
      ]),
    );
    next = withDepth(next, unit.id, depth);
  }
  return next;
}

/** Fresh random units, filled from a shuffled `order`. */
export function randomize(team: Team, order: CharId[], random: () => number = Math.random): Team {
  const shuffled = [...order];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  const cleared = sportOf(team).units.reduce((t, u) => clearSide(t, u.id), team);
  return autoFill(cleared, shuffled);
}
