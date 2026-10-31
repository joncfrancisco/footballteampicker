import { describe, expect, it } from "vitest";
import {
  autoFill,
  clearSide,
  filledCount,
  move,
  movedNotice,
  place,
  randomize,
  remove,
  setSection,
  shapeErrors,
  spotsOf,
  switchFront,
  usage,
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
      'Unknown character "ghost"',
      "Ahri already has a spot on offense",
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

describe("pool helpers", () => {
  const ids = Object.keys(chars);

  it("tracks which sides each character plays", () => {
    const t = team(["braum", O("LT", 1)], ["braum", D("NB", 1)], ["ahri", O("QB", 1)]);
    const u = usage(t);
    expect([...u.get("braum")!].sort()).toEqual(["defense", "offense"]);
    expect([...u.get("ahri")!]).toEqual(["offense"]);
    expect(u.has("zed")).toBe(false);
  });

  it("clears one side only", () => {
    const t = clearSide(team(["ahri", O("QB", 1)], ["jinx", D("FS", 1)]), "offense");
    expect(spotsOf(t, "ahri")).toEqual([]);
    expect(spotsOf(t, "jinx")).toEqual([D("FS", 1)]);
  });

  it("auto-fills empty spots from unused characters, keeping existing ones, never two-way", () => {
    const t = autoFill(team(["braum", O("QB", 1)]), ids);
    expect(t.offense.depth.QB).toEqual(["braum", "ahri", "jinx"]);
    expect(t.offense.depth.RB).toEqual(["leona", "zed", null]);
    expect(spotsOf(t, "braum")).toEqual([O("QB", 1)]);
    expect(violations(t, roster)).toEqual([]);
  });

  it("randomizes into a valid lineup using each character once", () => {
    let seed = 1;
    const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const big = new Map(
      Array.from({ length: 60 }, (_, i) => [`c${i}`, { name: `C${i}`, twoWay: false }]),
    );
    const t = randomize(newTeam({ id: "l", ip: "X" }), [...big.keys()], rng);
    expect(violations(t, big)).toEqual([]);
    const placed = [...Object.values(t.offense.depth), ...Object.values(t.defense.depth)]
      .flat()
      .filter((id) => id !== null);
    expect(placed).toHaveLength(52);
    expect(new Set(placed).size).toBe(52);
  });
});

describe("special teams and staff (#22)", () => {
  const ST = (pos: string, n: number): Spot => ({ side: "specialTeams", pos, index: n - 1 });
  const STAFF = (role: string): Spot => ({ side: "staff", pos: role, index: 0 });
  const withSections = (...placements: [string, Spot][]) =>
    placements.reduce(
      (t, [id, s]) => ok(place(t, roster, id, s)),
      setSection(setSection(newTeam({ id: "l", ip: "X" }), "specialTeams", true), "staff", true),
    );

  it("starts off and turns on empty, off removes the section entirely", () => {
    const t = newTeam({ id: "l", ip: "X" });
    expect(t).not.toHaveProperty("specialTeams");
    const on = setSection(setSection(t, "specialTeams", true), "staff", true);
    expect(on.specialTeams).toEqual({
      K: [null],
      P: [null],
      LS: [null],
      H: [null],
      KR: [null, null],
      PR: [null, null],
    });
    expect(on.staff).toEqual({ HC: null, OC: null, DC: null, STC: null, GM: null });
    expect(shapeErrors(on)).toEqual([]);
    expect(setSection(on, "staff", false)).not.toHaveProperty("staff");
  });

  it("lets anyone play special teams on top of an offense or defense spot", () => {
    const t = withSections(
      ["ahri", O("WR", 1)],
      ["ahri", ST("KR", 1)],
      ["jinx", D("LCB", 1)],
      ["jinx", ST("PR", 1)],
    );
    expect(spotsOf(t, "ahri")).toEqual([O("WR", 1), ST("KR", 1)]);
    expect(violations(t, roster)).toEqual([]);
  });

  it("allows KR + PR together", () => {
    const t = withSections(["ahri", ST("KR", 1)], ["ahri", ST("PR", 2)]);
    expect(spotsOf(t, "ahri")).toEqual([ST("KR", 1), ST("PR", 2)]);
    expect(violations(t, roster)).toEqual([]);
  });

  it("treats K then P as a move, and flags K + P together", () => {
    const t = ok(place(withSections(["ahri", ST("K", 1)]), roster, "ahri", ST("P", 1)));
    expect(spotsOf(t, "ahri")).toEqual([ST("P", 1)]);

    const bad = withSections();
    bad.specialTeams!.K = ["ahri"];
    bad.specialTeams!.P = ["ahri"];
    expect(violations(bad, roster)).toEqual(["Ahri already has a special teams spot"]);
  });

  it("dragging a player onto special teams keeps their offense spot", () => {
    const t = ok(move(withSections(["ahri", O("WR", 1)]), roster, O("WR", 1), ST("KR", 1)));
    expect(spotsOf(t, "ahri")).toEqual([O("WR", 1), ST("KR", 1)]);
  });

  it("a player named to staff leaves the roster, with a notice", () => {
    const t = withSections(["ahri", O("QB", 1)], ["ahri", ST("H", 1)]);
    const r = place(t, roster, "ahri", STAFF("HC"));
    expect(r.ok && r.notice).toBe("Ahri moved to staff and off the roster");
    expect(spotsOf(ok(r), "ahri")).toEqual([STAFF("HC")]);
  });

  it("staff can't play, and hold one role each", () => {
    const t = withSections(["ahri", STAFF("HC")]);
    expect(place(t, roster, "ahri", O("QB", 1))).toEqual({
      ok: false,
      reason: "Ahri is on staff and can't play",
    });
    expect(move(t, roster, STAFF("HC"), ST("K", 1)).ok).toBe(false);

    const moved = ok(place(t, roster, "ahri", STAFF("GM")));
    expect(spotsOf(moved, "ahri")).toEqual([STAFF("GM")]);

    const bad = withSections();
    bad.staff!.HC = "ahri";
    bad.staff!.OC = "ahri";
    bad.offense.depth.QB![0] = "jinx";
    bad.staff!.DC = "jinx";
    expect(violations(bad, roster)).toEqual([
      "Jinx is on staff and can't play",
      "Ahri already has a staff role",
    ]);
  });

  it("swaps staff roles", () => {
    const t = withSections(["ahri", STAFF("HC")], ["jinx", STAFF("OC")]);
    const next = ok(move(t, roster, STAFF("HC"), STAFF("OC")));
    expect(next.staff).toMatchObject({ HC: "jinx", OC: "ahri" });
  });

  it("auto-fill leaves staff off the field", () => {
    const t = autoFill(
      withSections(["ahri", STAFF("HC")], ["jinx", ST("K", 1)]),
      Object.keys(chars),
    );
    expect(spotsOf(t, "ahri")).toEqual([STAFF("HC")]);
    expect(violations(t, roster)).toEqual([]);
    expect(filledCount(t, "staff")).toBe(1);
  });

  it("flags bad section shapes", () => {
    const t = withSections();
    t.specialTeams!.KR = [null];
    expect(shapeErrors(t)).toEqual(["special teams KR must have 2 spots"]);
  });
});
