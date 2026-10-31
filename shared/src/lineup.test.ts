import { describe, expect, it } from "vitest";
import {
  move,
  movedNotice,
  place,
  remove,
  shapeErrors,
  spotsOf,
  switchFront,
  violations,
  type Result,
  type Roster,
  type Spot,
} from "./lineup";
import { newTeam, type Team } from "./team";

const chars = {
  ahri: { name: "Ahri", twoWay: false },
  braum: { name: "Braum", twoWay: true },
  jinx: { name: "Jinx", twoWay: false },
  leona: { name: "Leona", twoWay: false },
  zed: { name: "Zed", twoWay: false },
};
const roster: Roster = new Map(Object.entries(chars));

const O = (pos: string, n: number): Spot => ({ side: "offense", pos, index: n - 1 });
const D = (pos: string, n: number): Spot => ({ side: "defense", pos, index: n - 1 });

function ok(r: Result): Team {
  if (!r.ok) throw new Error(r.reason);
  return r.team;
}

function team(...placements: [string, Spot][]): Team {
  return placements.reduce(
    (t, [id, s]) => ok(place(t, roster, id, s)),
    newTeam({ id: "l", ip: "X" }),
  );
}

describe("place", () => {
  it("puts a pool character in an empty spot", () => {
    const t = team(["ahri", O("QB", 1)]);
    expect(t.offense.depth.QB).toEqual(["ahri", null, null]);
  });

  it("replaces the occupant, who returns to the pool", () => {
    const t = ok(place(team(["ahri", O("QB", 1)]), roster, "jinx", O("QB", 1)));
    expect(t.offense.depth.QB![0]).toBe("jinx");
    expect(spotsOf(t, "ahri")).toEqual([]);
  });

  it("moves a character who already plays that side instead of duplicating them", () => {
    const t = ok(place(team(["ahri", O("QB", 1)]), roster, "ahri", O("WR", 3)));
    expect(spotsOf(t, "ahri")).toEqual([O("WR", 3)]);
  });

  it("refuses a one-way player on the other side", () => {
    const r = place(team(["ahri", O("QB", 1)]), roster, "ahri", D("MLB", 1));
    expect(r).toEqual({ ok: false, reason: "Ahri isn't a two-way player" });
  });

  it("lets a two-way player hold one spot on each side", () => {
    const t = team(["braum", O("LT", 1)], ["braum", D("NB", 1)]);
    expect(spotsOf(t, "braum")).toEqual([O("LT", 1), D("NB", 1)]);
    expect(violations(t, roster)).toEqual([]);
  });

  it("refuses unknown characters and spots", () => {
    const t = newTeam({ id: "l", ip: "X" });
    expect(place(t, roster, "nobody", O("QB", 1)).ok).toBe(false);
    expect(place(t, roster, "ahri", O("QB", 4)).ok).toBe(false);
    expect(place(t, roster, "ahri", D("NT", 1)).ok).toBe(false); // 4-3 has no NT
  });
});

describe("move", () => {
  it("reorders within a row: promoting WR4 to WR2 shifts WR2 and WR3 down", () => {
    const t = team(
      ["ahri", O("WR", 1)],
      ["jinx", O("WR", 2)],
      ["zed", O("WR", 3)],
      ["leona", O("WR", 4)],
    );
    const next = ok(move(t, roster, O("WR", 4), O("WR", 2)));
    expect(next.offense.depth.WR).toEqual(["ahri", "leona", "jinx", "zed", null, null]);
  });

  it("swaps across rows", () => {
    const t = team(["ahri", O("QB", 1)], ["jinx", O("WR", 1)]);
    const next = ok(move(t, roster, O("QB", 1), O("WR", 1)));
    expect(next.offense.depth.QB![0]).toBe("jinx");
    expect(next.offense.depth.WR![0]).toBe("ahri");
  });

  it("moves into an empty spot in another row", () => {
    const next = ok(move(team(["ahri", O("QB", 1)]), roster, O("QB", 1), O("TE", 2)));
    expect(spotsOf(next, "ahri")).toEqual([O("TE", 2)]);
  });

  it("swaps across sides when both stay one-way", () => {
    const t = team(["ahri", O("QB", 1)], ["jinx", D("FS", 1)]);
    const next = ok(move(t, roster, O("QB", 1), D("FS", 1)));
    expect(spotsOf(next, "ahri")).toEqual([D("FS", 1)]);
    expect(spotsOf(next, "jinx")).toEqual([O("QB", 1)]);
  });

  it("refuses a swap that gives a two-way player two spots on one side", () => {
    // Braum's NB1 swaps with Ahri's QB1: Braum would hold LT1 and QB1.
    const t = team(["braum", O("LT", 1)], ["braum", D("NB", 1)], ["ahri", O("QB", 1)]);
    const r = move(t, roster, D("NB", 1), O("QB", 1));
    expect(r).toEqual({ ok: false, reason: "Braum already has a spot on offense" });
  });

  it("never leaves a one-way player on both sides: a cross-side move vacates their spot", () => {
    const t = team(["ahri", O("QB", 1)], ["braum", D("NB", 1)]);
    const next = ok(move(t, roster, O("QB", 1), D("NB", 1)));
    expect(spotsOf(next, "ahri")).toEqual([D("NB", 1)]);
    expect(violations(next, roster)).toEqual([]);
  });

  it("does nothing for an empty source", () => {
    expect(move(newTeam({ id: "l", ip: "X" }), roster, O("QB", 1), O("QB", 2)).ok).toBe(false);
  });
});

describe("remove", () => {
  it("sends the occupant to the pool", () => {
    const t = remove(team(["ahri", O("QB", 1)]), O("QB", 1));
    expect(spotsOf(t, "ahri")).toEqual([]);
  });
});

describe("switchFront", () => {
  it("keeps shared rows, maps LDT to NT and linebackers in order, pools the rest", () => {
    const t = team(
      ["ahri", D("LDE", 1)],
      ["jinx", D("LDT", 1)],
      ["zed", D("RDT", 1)],
      ["leona", D("SLB", 2)],
      ["braum", D("FS", 1)],
    );
    const { team: next, moved } = switchFront(t, "3-4");
    expect(next.defense.front).toBe("3-4");
    expect(next.defense.formation).toBe("34-okie");
    expect(next.defense.depth.LDE![0]).toBe("ahri");
    expect(next.defense.depth.NT![0]).toBe("jinx");
    expect(next.defense.depth.RILB![1]).toBe("leona");
    expect(next.defense.depth.FS![0]).toBe("braum");
    expect(moved).toEqual(["zed"]);
    expect(shapeErrors(next)).toEqual([]);
    expect(movedNotice(moved)).toBe("1 player moved to the pool");
  });

  it("maps back from 3-4, pooling ROLB", () => {
    const t34 = switchFront(newTeam({ id: "l", ip: "X" }), "3-4").team;
    const t = ok(place(ok(place(t34, roster, "ahri", D("NT", 1))), roster, "jinx", D("ROLB", 1)));
    const { team: next, moved } = switchFront(t, "4-3");
    expect(next.defense.depth.LDT![0]).toBe("ahri");
    expect(moved).toEqual(["jinx"]);
    expect(movedNotice(["a", "b"])).toBe("2 players moved to the pool");
  });
});

describe("violations and shape", () => {
  it("flags duplicates on one side, one-way players on both sides and unknown ids", () => {
    const t = newTeam({ id: "l", ip: "X" });
    t.offense.depth.QB = ["ahri", "ahri", null];
    t.defense.depth.MLB = ["ahri", null];
    t.offense.depth.RB = ["ghost", null, null];
    expect(violations(t, roster)).toEqual([
      "Ahri already has a spot on offense",
      'Unknown character "ghost"',
      "Ahri isn't a two-way player",
    ]);
  });

  it("flags rows that don't match the front's template", () => {
    const t = newTeam({ id: "l", ip: "X" });
    t.defense.depth.NT = [null, null];
    t.offense.depth.WR = [null];
    expect(shapeErrors(t)).toEqual(["offense WR must have 6 spots", "defense has no NT row"]);
  });
});
