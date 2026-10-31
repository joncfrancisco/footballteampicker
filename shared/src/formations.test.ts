import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEFENSE,
  DEFAULT_OFFENSE,
  FORMATIONS,
  LOS_Y,
  defenseFormations,
  formationById,
  formationLabel,
  offenseFormations,
  refLabel,
  slotsFor,
} from "./formations";
import { FRONTS, rowsFor } from "./positions";

const count = (f: (typeof FORMATIONS)[number], ...pos: string[]) =>
  f.slots.filter((s) => pos.includes(s.ref.pos)).length;

describe.each(FORMATIONS.map((f) => [f.id, f] as const))("%s", (_id, f) => {
  it("has exactly 11 slots with unique ids and refs", () => {
    expect(f.slots).toHaveLength(11);
    expect(new Set(f.slots.map((s) => s.id)).size).toBe(11);
    expect(new Set(f.slots.map((s) => refLabel(s.ref))).size).toBe(11);
  });

  it("only uses depth spots that exist for its side and front", () => {
    const rows = f.side === "offense" ? rowsFor("offense") : rowsFor("defense", f.front!);
    for (const { ref } of f.slots) {
      expect(rows, refLabel(ref)).toHaveProperty(ref.pos);
      expect(ref.depth).toBeGreaterThanOrEqual(1);
      expect(ref.depth).toBeLessThanOrEqual(rows[ref.pos as keyof typeof rows]!);
    }
  });

  it("lines up on its own side of the ball, inside the field", () => {
    for (const slot of slotsFor(f, f.qb === "gun" ? "under" : "gun")) {
      expect(slot.x).toBeGreaterThanOrEqual(0);
      expect(slot.x).toBeLessThanOrEqual(100);
      if (f.side === "offense") expect(slot.y).toBeGreaterThan(LOS_Y);
      else expect(slot.y).toBeLessThan(LOS_Y);
    }
  });

  if (f.side === "offense") {
    it("matches its personnel label and uses the whole line", () => {
      const [backs, tes] = f.personnel!.split("").map(Number);
      expect(count(f, "RB", "FB")).toBe(backs);
      expect(count(f, "TE")).toBe(tes);
      expect(count(f, "WR")).toBe(5 - backs! - tes!);
      expect(count(f, "QB")).toBe(1);
      expect(count(f, "LT", "LG", "C", "RG", "RT")).toBe(5);
    });
  } else {
    it("matches its package", () => {
      const dbs = { base: 4, nickel: 5, dime: 6 }[f.package!];
      expect(count(f, "LCB", "RCB", "SS", "FS", "NB", "DB")).toBe(dbs);
    });
  }
});

describe("catalog", () => {
  it("has 8 offensive and 7 defensive formations", () => {
    expect(offenseFormations()).toHaveLength(8);
    expect(defenseFormations("4-3")).toHaveLength(4);
    expect(defenseFormations("3-4")).toHaveLength(3);
  });

  it("has a default for offense and each front", () => {
    expect(formationById(DEFAULT_OFFENSE)?.side).toBe("offense");
    for (const front of FRONTS) expect(formationById(DEFAULT_DEFENSE[front])?.front).toBe(front);
  });

  it("labels offense by personnel", () => {
    expect(formationLabel(formationById("11-shotgun-trips")!)).toBe("11 · Shotgun Trips");
    expect(formationLabel(formationById("43-nickel")!)).toBe("4-2-5 Nickel");
  });

  it("moves only the QB and back when toggling alignment", () => {
    const f = formationById(DEFAULT_OFFENSE)!;
    const gun = slotsFor(f, "gun");
    const moved = gun.filter((s, i) => s.x !== f.slots[i]!.x || s.y !== f.slots[i]!.y);
    expect(moved.map((s) => s.id).sort()).toEqual(["qb", "rb"]);
    expect(slotsFor(f, "under")).toBe(f.slots);
  });
});
