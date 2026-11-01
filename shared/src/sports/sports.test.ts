import { describe, expect, it } from "vitest";
import {
  autoFill,
  moveInOrder,
  place,
  randomize,
  setSection,
  shapeErrors,
  switchVariant,
  violations,
} from "../lineup";
import { refLabel } from "../formations";
import { unitDef, unitFormations, unitRows } from "../sport";
import { newTeam } from "../team";
import { teamErrors } from "../schemas";
import { SPORTS } from ".";

/** Every registered sport must be complete, valid data (#44). */
describe.each(SPORTS.map((s) => [s.id, s] as const))("%s", (_id, sport) => {
  const roster = new Map(
    Array.from({ length: 80 }, (_, i) => [`c${i}`, { name: `C${i}`, twoWay: false }]),
  );

  it("has unique unit and section ids, one staff section called staff", () => {
    const ids = [...sport.units.map((u) => u.id), ...sport.sections.map((s) => s.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z]{1,16}$/);
    const staff = sport.sections.filter((s) => s.kind === "staff");
    expect(staff.map((s) => s.id)).toEqual(["staff"]);
    for (const role of Object.keys(staff[0]!.rows)) expect(staff[0]!.titles?.[role]).toBeTruthy();
  });

  it("uses row names and depths the API accepts", () => {
    const rows = [
      ...sport.units.flatMap((u) => u.variants.map((v) => v.rows)),
      ...sport.sections.map((s) => s.rows),
    ];
    for (const r of rows)
      for (const [pos, n] of Object.entries(r)) {
        expect(pos).toMatch(/^[A-Z0-9]{1,4}$/);
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(7);
      }
  });

  it("has a valid default for every unit and variant", () => {
    for (const unit of sport.units)
      for (const v of unit.variants) {
        const team = newTeam({ id: "l", ip: "X" }, sport.id, { [unit.id]: v.id });
        expect(teamErrors(team, roster)).toEqual([]);
        if (unit.defaultFormation)
          expect(unitFormations(sport, unit.id, v.id).map((f) => f.id)).toContain(
            unit.defaultFormation[v.id],
          );
      }
  });

  it.each(sport.formations.map((f) => [f.id, f] as const))(
    "formation %s only uses spots that exist, once each, on the surface",
    (_f, f) => {
      const unit = unitDef(sport, f.unit)!;
      expect(unit).toBeDefined();
      expect(new Set(f.slots.map((s) => s.id)).size).toBe(f.slots.length);
      expect(new Set(f.slots.map((s) => `${s.ref.unit ?? ""}${refLabel(s.ref)}`)).size).toBe(
        f.slots.length,
      );
      const variants = f.variant ? [f.variant] : unit.variants.map((v) => v.id);
      for (const variant of variants)
        for (const slot of f.slots) {
          const rows = slot.ref.unit
            ? unitRows(unitDef(sport, slot.ref.unit)!)
            : unitRows(unit, variant);
          expect(rows, refLabel(slot.ref)).toHaveProperty(slot.ref.pos);
          expect(slot.ref.depth).toBeLessThanOrEqual(rows[slot.ref.pos]!);
          expect(slot.x).toBeGreaterThanOrEqual(0);
          expect(slot.x).toBeLessThanOrEqual(100);
          expect(slot.y).toBeGreaterThanOrEqual(0);
          expect(slot.y).toBeLessThanOrEqual(100);
        }
    },
  );

  it("auto-fills and randomizes into a valid team, sections on", () => {
    const ids = [...roster.keys()];
    let team = sport.sections.reduce(
      (t, s) => setSection(t, s.id, true),
      newTeam({ id: "l", ip: "X" }, sport.id),
    );
    expect(shapeErrors(team)).toEqual([]);
    team = autoFill(team, ids);
    expect(violations(team, roster)).toEqual([]);
    expect(violations(randomize(team, ids), roster)).toEqual([]);
  });
});

describe("hockey special teams (#64)", () => {
  const roster = new Map([
    ["g", { name: "Goalie", twoWay: false }],
    ["f", { name: "Forward", twoWay: false }],
  ]);
  const base = () =>
    setSection(
      setSection(newTeam({ id: "l", ip: "X" }, "hockey"), "powerPlay", true),
      "penaltyKill",
      true,
    );

  it("keeps goalies off the power play and penalty kill, either way round", () => {
    let t = place(base(), roster, "g", { side: "lineup", pos: "G", index: 0 });
    expect(t.ok && place(t.team, roster, "g", { side: "powerPlay", pos: "PP1", index: 0 })).toEqual(
      {
        ok: false,
        reason: "Goalie is a goalie and can't play power play",
      },
    );
    t = place(base(), roster, "f", { side: "penaltyKill", pos: "PK2", index: 3 });
    expect(t.ok && place(t.team, roster, "f", { side: "lineup", pos: "G", index: 1 }).ok).toBe(
      false,
    );
  });

  it("lets a skater play a line, the power play and the penalty kill", () => {
    let t = base();
    for (const spot of [
      { side: "lineup", pos: "C", index: 0 },
      { side: "powerPlay", pos: "PP1", index: 2 },
      { side: "penaltyKill", pos: "PK1", index: 0 },
    ]) {
      const r = place(t, roster, "f", spot);
      if (!r.ok) throw new Error(r.reason);
      t = r.team;
    }
    expect(violations(t, roster)).toEqual([]);
    // A second power-play spot is a move within the power play.
    const r = place(t, roster, "f", { side: "powerPlay", pos: "PP2", index: 0 });
    expect(r.ok && r.team.sections!.powerPlay!.PP1![2]).toBeNull();
  });
});

describe("baseball (#65)", () => {
  const roster = new Map([
    ["ohtani", { name: "Ohtani", twoWay: true }],
    ["one", { name: "One-way", twoWay: false }],
  ]);
  const P = (pos: string, index = 0) => ({ side: "pitchers", pos, index });
  const H = (pos: string, index = 0) => ({ side: "hitters", pos, index });

  it("lets only a two-way player pitch and hit", () => {
    let t = newTeam({ id: "l", ip: "X" }, "baseball");
    const sp = place(t, roster, "ohtani", P("SP"));
    if (!sp.ok) throw new Error(sp.reason);
    const dh = place(sp.team, roster, "ohtani", H("DH"));
    expect(dh.ok).toBe(true);
    t = (place(t, roster, "one", P("RP", 3)) as { team: typeof t }).team;
    expect(place(t, roster, "one", H("CF"))).toEqual({
      ok: false,
      reason: "One-way isn't a two-way player",
    });
  });

  it("turning the DH off pools the DH and bats the pitcher in the DH's place", () => {
    let t = newTeam({ id: "l", ip: "X" }, "baseball");
    t = moveInOrder(t, "hitters", "DH", -1); // DH bats 3rd
    t = (place(t, roster, "one", H("DH")) as { team: typeof t }).team;
    const { team: off, moved } = switchVariant(t, "hitters", "no-dh");
    expect(moved).toEqual(["one"]);
    expect(off.units.hitters!.depth).not.toHaveProperty("DH");
    expect(off.units.hitters!.order).toEqual(["CF", "SS", "P", "1B", "3B", "RF", "LF", "2B", "C"]);
    expect(teamErrors(off, roster)).toEqual([]);
    const back = switchVariant(off, "hitters", "dh").team;
    expect(back.units.hitters!.order![2]).toBe("DH");
  });

  it("refuses a batting order that isn't the nine starters", () => {
    const t = newTeam({ id: "l", ip: "X" }, "baseball");
    t.units.hitters!.order = ["CF", "SS", "1B", "DH", "3B", "RF", "LF", "2B", "BN"];
    expect(teamErrors(t, roster)).toEqual([
      "Batting order must list CF, SS, 1B, DH, 3B, RF, LF, 2B, C once each",
    ]);
  });
});
