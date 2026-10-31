import { DEFAULT_DEFENSE, type DepthRef } from "./formations";
import { DEFENSE_ROWS, rowsFor, type Front } from "./positions";
import { emptyDepth, type CharId, type Depth, type Team } from "./team";

/**
 * The lineup rules, shared by the builder (#7, #21) and the API's team validation (#9).
 * Every edit goes through here and either returns the new team or a reason it was refused.
 */

export type Spot = { side: "offense" | "defense"; pos: string; index: number };
export type Roster = { get(id: CharId): { name: string; twoWay: boolean } | undefined };

export type Result = { ok: true; team: Team; notice?: string } | { ok: false; reason: string };

const SIDES = ["offense", "defense"] as const;

export function spotRef(spot: Spot): DepthRef {
  return { pos: spot.pos as DepthRef["pos"], depth: spot.index + 1 };
}

export function at(team: Team, spot: Spot): CharId | null {
  return team[spot.side].depth[spot.pos]?.[spot.index] ?? null;
}

/** Every spot a character holds. */
export function spotsOf(team: Team, id: CharId): Spot[] {
  return SIDES.flatMap((side) =>
    Object.entries(team[side].depth).flatMap(([pos, row]) =>
      row.flatMap((c, index) => (c === id ? [{ side, pos, index }] : [])),
    ),
  );
}

function withDepth(team: Team, side: Spot["side"], depth: Depth): Team {
  return { ...team, [side]: { ...team[side], depth } };
}

function exists(team: Team, spot: Spot): boolean {
  const row = team[spot.side].depth[spot.pos];
  return !!row && spot.index >= 0 && spot.index < row.length;
}

function set(team: Team, spot: Spot, id: CharId | null): Team {
  const depth = { ...team[spot.side].depth };
  const row = [...depth[spot.pos]!];
  row[spot.index] = id;
  depth[spot.pos] = row;
  return withDepth(team, spot.side, depth);
}

/** Rule violations for the whole team, as human-readable reasons. Empty means valid. */
export function violations(team: Team, roster: Roster): string[] {
  const out: string[] = [];
  const seen = new Map<CharId, Set<Spot["side"]>>();
  for (const side of SIDES) {
    const counted = new Set<CharId>();
    for (const row of Object.values(team[side].depth)) {
      for (const id of row) {
        if (id === null) continue;
        const c = roster.get(id);
        if (!c) {
          out.push(`Unknown character "${id}"`);
          continue;
        }
        if (counted.has(id)) out.push(`${c.name} already has a spot on ${side}`);
        counted.add(id);
        seen.set(id, (seen.get(id) ?? new Set()).add(side));
      }
    }
  }
  for (const [id, sides] of seen) {
    const c = roster.get(id)!;
    if (sides.size > 1 && !c.twoWay) out.push(`${c.name} isn't a two-way player`);
  }
  return out;
}

/** Shape check: rows match the side's template (and the front for defense). */
export function shapeErrors(team: Team): string[] {
  const out: string[] = [];
  const check = (side: Spot["side"], rows: Readonly<Record<string, number>>) => {
    const depth = team[side].depth;
    for (const [pos, n] of Object.entries(rows))
      if (depth[pos]?.length !== n) out.push(`${side} ${pos} must have ${n} spots`);
    for (const pos of Object.keys(depth)) if (!(pos in rows)) out.push(`${side} has no ${pos} row`);
  };
  check("offense", rowsFor("offense"));
  check("defense", rowsFor("defense", team.defense.front));
  return out;
}

/** Apply `next` only if the edit introduced no new rule violations. */
function commit(before: Team, next: Team, roster: Roster): Result {
  const already = new Set(violations(before, roster));
  const fresh = violations(next, roster).find((v) => !already.has(v));
  return fresh ? { ok: false, reason: fresh } : { ok: true, team: next };
}

/**
 * Put a character from the pool into a spot. Whoever was there goes back to the pool. If the
 * character already holds a spot on that side, this is a move from that spot instead.
 */
export function place(team: Team, roster: Roster, id: CharId, to: Spot): Result {
  const c = roster.get(id);
  if (!c) return { ok: false, reason: `Unknown character "${id}"` };
  if (!exists(team, to)) return { ok: false, reason: `No ${to.pos}${to.index + 1} spot` };
  const current = spotsOf(team, id).find((s) => s.side === to.side);
  if (current) return move(team, roster, current, to);
  const onOtherSide = spotsOf(team, id).length > 0;
  if (onOtherSide && !c.twoWay) return { ok: false, reason: `${c.name} isn't a two-way player` };
  return commit(team, set(team, to, id), roster);
}

/**
 * Move whoever is in `from` to `to`. Within one row this reorders (everyone between shifts
 * down a spot, so promoting WR4 to WR2 makes the old WR2 the WR3). Anywhere else it swaps.
 */
export function move(team: Team, roster: Roster, from: Spot, to: Spot): Result {
  if (!exists(team, from) || !exists(team, to)) return { ok: false, reason: "No such spot" };
  const id = at(team, from);
  if (id === null) return { ok: false, reason: "Nobody to move" };
  if (from.side === to.side && from.pos === to.pos) {
    if (from.index === to.index) return { ok: true, team };
    const depth = { ...team[from.side].depth };
    const row = [...depth[from.pos]!];
    row.splice(from.index, 1);
    row.splice(to.index, 0, id);
    depth[from.pos] = row;
    return { ok: true, team: withDepth(team, from.side, depth) };
  }
  const other = at(team, to);
  const next = set(set(team, from, other), to, id);
  return commit(team, next, roster);
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
