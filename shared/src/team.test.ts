import { describe, expect, it } from "vitest";
import { atRef, newTeam, upgradeTeam } from "./team";

describe("newTeam", () => {
  it("starts empty with the default formations and a title from the list", () => {
    const team = newTeam({ id: "demo-lol", ip: "League of Legends" });
    expect(team.title).toBe("My League of Legends Team");
    expect(team.units.offense!.formation).toBe("11-singleback");
    expect(team.units.defense!.formation).toBe("43-over");
    expect(team.units.offense!.depth.WR).toEqual([null, null, null, null, null, null]);
    expect(team.units.defense!.depth.DB).toEqual([null]);
    expect(team.units.defense!.depth).not.toHaveProperty("NT");
  });

  it("builds the 3-4 rows for a 3-4 front", () => {
    const team = newTeam({ id: "x", ip: "X" }, "football", { defense: "3-4" });
    expect(team.units.defense!.formation).toBe("34-okie");
    expect(team.units.defense!.depth).toHaveProperty("NT");
    expect(team.units.defense!.depth).not.toHaveProperty("LDT");
  });
});

describe("atRef", () => {
  it("reads 1-based depth spots", () => {
    const team = newTeam({ id: "x", ip: "X" });
    team.units.offense!.depth.WR![2] = "Ahri";
    expect(atRef(team.units.offense!.depth, { pos: "WR", depth: 3 })).toBe("Ahri");
    expect(atRef(team.units.offense!.depth, { pos: "WR", depth: 1 })).toBeNull();
  });
});

describe("upgradeTeam (#44)", () => {
  it("leaves current teams alone", () => {
    const team = newTeam({ id: "x", ip: "X" });
    expect(upgradeTeam(team)).toBe(team);
  });

  it("reads a v1 football team, keeping everything else on it", () => {
    const v1 = {
      schema: 1,
      id: "abcdefghij",
      title: "T",
      listId: "x",
      offense: { depth: { QB: ["a"] }, formation: "00-empty", qb: "gun" as const },
      defense: { front: "3-4" as const, depth: { NT: ["b"] }, formation: "34-okie" },
      staff: { HC: "c", OC: null },
    };
    expect(upgradeTeam(v1)).toEqual({
      schema: 1,
      id: "abcdefghij",
      title: "T",
      listId: "x",
      schemaVersion: 2,
      sport: "football",
      units: {
        offense: { depth: { QB: ["a"] }, formation: "00-empty", align: "gun" },
        defense: { depth: { NT: ["b"] }, formation: "34-okie", variant: "3-4" },
      },
      sections: { staff: { HC: ["c"], OC: [null] } },
    });
  });
});
