import { DEFAULT_DEFENSE, type DepthRef } from "./formations";
import { DEFENSE_ROWS, SPECIAL_TEAMS_ROWS, STAFF_ROLES, rowsFor, type Front } from "./positions";
import {
  emptyDepth,
  emptySpecialTeams,
  emptyStaff,
  type CharId,
  type Depth,
  type Team,
} from "./team";

/**
 * The lineup rules, shared by the builder (#7, #21) and the API's team validation (#9).
 * Every edit goes through here and either returns the new team or a reason it was refused.
 */

export type TeamSide = "offense" | "defense" | "specialTeams" | "staff";
/** A place on the team. Staff roles are rows one deep: { side: "staff", pos: "HC", index: 0 }. */
export type Spot = { side: TeamSide; pos: string; index: number };
export type Roster = { get(id: CharId): { name: string; twoWay: boolean } | undefined };

export type Result = { ok: true; team: Team; notice?: string } | { ok: false; reason: string };

const SIDES = ["offense", "defense", "specialTeams", "staff"] as const;
const PLAYING = new Set<TeamSide>(["offense", "defense", "specialTeams"]);
const SIDE_NAMES: Record<TeamSide, string> = {
  offense: "offense",
  defense: "defense",
  specialTeams: "special teams",
  staff: "staff",
};

/** Every side as depth rows (staff roles become rows one deep), or undefined if it's off. */
export function depthOf(team: Team, side: TeamSide): Depth | undefined {
  if (side === "offense" || side === "defense") return team[side].depth;
  if (side === "specialTeams") return team.specialTeams;
  return team.staff && Object.fromEntries(Object.entries(team.staff).map(([r, id]) => [r, [id]]));
}

export function spotRef(spot: Spot): DepthRef {
  return { pos: spot.pos as DepthRef["pos"], depth: spot.index + 1 };
}

export function at(team: Team, spot: Spot): CharId | null {
  return depthOf(team, spot.side)?.[spot.pos]?.[spot.index] ?? null;
}

/** Every spot a character holds. */
export function spotsOf(team: Team, id: CharId): Spot[] {
  return SIDES.flatMap((side) =>
    Object.entries(depthOf(team, side) ?? {}).flatMap(([pos, row]) =>
      row.flatMap((c, index) => (c === id ? [{ side, pos, index }] : [])),
    ),
  );
}

function withDepth(team: Team, side: TeamSide, depth: Depth): Team {
  if (side === "offense" || side === "defense")
    return { ...team, [side]: { ...team[side], depth } };
  if (side === "specialTeams") return { ...team, specialTeams: depth };
  const staff = Object.fromEntries(Object.entries(depth).map(([r, row]) => [r, row[0] ?? null]));
  return { ...team, staff: staff as NonNullable<Team["staff"]> };
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

/** Rule violations for the whole team, as human-readable reasons. Empty means valid. */
export function violations(team: Team, roster: Roster): string[] {
  const out: string[] = [];
  const spots = new Map<CharId, Spot[]>();
  for (const side of SIDES)
    for (const [pos, row] of Object.entries(depthOf(team, side) ?? {}))
      row.forEach((id, index) => {
        if (id === null) return;
        if (!roster.get(id)) out.push(`Unknown character "${id}"`);
        else spots.set(id, [...(spots.get(id) ?? []), { side, pos, index }]);
      });

  for (const [id, held] of spots) {
    const name = roster.get(id)!.name;
    const on = (side: TeamSide) => held.filter((s) => s.side === side);
    for (const side of ["offense", "defense"] as const)
      if (on(side).length > 1) out.push(`${name} already has a spot on ${side}`);
    if (on("offense").length && on("defense").length && !roster.get(id)!.twoWay)
      out.push(`${name} isn't a two-way player`);
    // One special teams spot each, except a kick returner can also return punts.
    const st = on("specialTeams")
      .map((s) => s.pos)
      .sort();
    if (st.length > 1 && !(st.length === 2 && st[0] === "KR" && st[1] === "PR"))
      out.push(`${name} already has a special teams spot`);
    if (on("staff").length > 1) out.push(`${name} already has a staff role`);
    if (on("staff").length && held.some((s) => PLAYING.has(s.side)))
      out.push(`${name} is on staff and can't play`);
  }
  return out;
}

/** Shape check: rows match each side's template (and the front for defense). */
export function shapeErrors(team: Team): string[] {
  const out: string[] = [];
  const check = (side: TeamSide, rows: Readonly<Record<string, number>>) => {
    const depth = depthOf(team, side);
    if (!depth) return;
    const name = SIDE_NAMES[side];
    for (const [pos, n] of Object.entries(rows))
      if (depth[pos]?.length !== n) out.push(`${name} ${pos} must have ${n} spots`);
    for (const pos of Object.keys(depth)) if (!(pos in rows)) out.push(`${name} has no ${pos} row`);
  };
  check("offense", rowsFor("offense"));
  check("defense", rowsFor("defense", team.defense.front));
  check("specialTeams", SPECIAL_TEAMS_ROWS);
  check("staff", Object.fromEntries(STAFF_ROLES.map((r) => [r, 1])));
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
 * - Offense/defense: if they already play that side, this is a move from that spot instead.
 * - Special teams: on top of any offense/defense spot. One each, except KR + PR together.
 * - Staff: staff don't play, so a player named to staff leaves the roster (with a notice); a
 *   staff member can't be put in a player spot.
 */
export function place(team: Team, roster: Roster, id: CharId, to: Spot): Result {
  const c = roster.get(id);
  if (!c) return { ok: false, reason: `Unknown character "${id}"` };
  if (!exists(team, to)) return { ok: false, reason: `No ${to.pos}${to.index + 1} spot` };
  const held = spotsOf(team, id);
  const same = held.filter((s) => s.side === to.side);

  if (to.side === "staff") {
    if (same.length) return move(team, roster, same[0]!, to);
    const playing = held.filter((s) => PLAYING.has(s.side));
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
  if (held.some((s) => s.side === "staff"))
    return { ok: false, reason: `${c.name} is on staff and can't play` };

  if (to.side === "specialTeams") {
    const samePos = same.find((s) => s.pos === to.pos);
    const returnPair = same.length === 1 && [same[0]!.pos, to.pos].sort().join() === "KR,PR";
    if (samePos) return move(team, roster, samePos, to);
    if (same.length && !returnPair) return move(team, roster, same[0]!, to);
    return commit(team, set(team, to, id), roster);
  }

  if (same.length) return move(team, roster, same[0]!, to);
  const otherSide = held.some((s) => s.side === "offense" || s.side === "defense");
  if (otherSide && !c.twoWay) return { ok: false, reason: `${c.name} isn't a two-way player` };
  return commit(team, set(team, to, id), roster);
}

/**
 * Move whoever is in `from` to `to`. Within one row this reorders (everyone between shifts
 * down a spot, so promoting WR4 to WR2 makes the old WR2 the WR3). Between offense/defense
 * spots, or between staff roles, it swaps. Onto special teams or staff from elsewhere it
 * works like a placement (special teams are on top of a player's spot; staff leave the
 * roster). Staff can't move onto a player spot.
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
  if (from.side === "staff" && to.side !== "staff")
    return { ok: false, reason: `${roster.get(id)?.name ?? id} is on staff and can't play` };
  if (
    to.side !== from.side &&
    (to.side === "staff" || to.side === "specialTeams" || from.side === "specialTeams")
  )
    return place(team, roster, id, to);
  const other = at(team, to);
  return commit(team, set(set(team, from, other), to, id), roster);
}

/** Send whoever is in a spot back to the pool. */
export function remove(team: Team, spot: Spot): Team {
  return exists(team, spot) ? set(team, spot, null) : team;
}

/**
 * Change the defensive front. Rows that exist in both fronts keep their players; LDT ↔ NT and
 * the linebackers map in order (WLB, MLB, SLB ↔ LOLB, LILB, RILB, ROLB). Anyone left over goes
 * to the pool and is reported, e.g. "2 players moved to the pool".
 */
export function switchFront(team: Team, front: Front): { team: Team; moved: CharId[] } {
  const from = team.defense.front;
  if (from === front) return { team, moved: [] };
  const map: Record<string, string> =
    from === "4-3"
      ? { LDT: "NT", WLB: "LOLB", MLB: "LILB", SLB: "RILB" }
      : { NT: "LDT", LOLB: "WLB", LILB: "MLB", RILB: "SLB" };
  const target = emptyDepth(DEFENSE_ROWS[front]);
  const moved: CharId[] = [];
  for (const [pos, row] of Object.entries(team.defense.depth)) {
    const dest = pos in target ? pos : map[pos];
    row.forEach((id, i) => {
      if (id === null) return;
      if (dest && i < target[dest]!.length) target[dest]![i] = id;
      else moved.push(id);
    });
  }
  return {
    team: { ...team, defense: { front, depth: target, formation: DEFAULT_DEFENSE[front] } },
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
  for (const side of SIDES)
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
export function setSection(team: Team, section: "specialTeams" | "staff", on: boolean): Team {
  if (on === (team[section] !== undefined)) return team;
  if (!on) {
    const { [section]: _removed, ...rest } = team;
    return rest;
  }
  return section === "specialTeams"
    ? { ...team, specialTeams: emptySpecialTeams() }
    : { ...team, staff: emptyStaff() };
}

/** How many spots on a side are filled (e.g. to confirm before turning a section off). */
export function filledCount(team: Team, side: TeamSide): number {
  return Object.values(depthOf(team, side) ?? {})
    .flat()
    .filter((id) => id !== null).length;
}

/**
 * Fill every empty offense and defense spot, offense first, from characters who aren't on
 * the team yet, in `order`. Nobody is put on both sides, so the result is valid whatever the
 * two-way flags say. Special teams and staff are left alone.
 */
export function autoFill(team: Team, order: CharId[]): Team {
  const used = usage(team);
  const queue = order.filter((id) => !used.has(id));
  let next = team;
  for (const side of ["offense", "defense"] as const) {
    const depth = Object.fromEntries(
      Object.entries(next[side].depth).map(([pos, row]) => [
        pos,
        row.map((id) => id ?? queue.shift() ?? null),
      ]),
    );
    next = withDepth(next, side, depth);
  }
  return next;
}

/** A fresh random offense and defense, filled from a shuffled `order`. */
export function randomize(team: Team, order: CharId[], random: () => number = Math.random): Team {
  const shuffled = [...order];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return autoFill(clearSide(clearSide(team, "offense"), "defense"), shuffled);
}
