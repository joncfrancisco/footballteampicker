import { describe, expect, it } from "vitest";
import { atRef, newTeam } from "./team";

describe("newTeam", () => {
  it("starts empty with the default formations and a title from the list", () => {
    const team = newTeam({ id: "demo-lol", ip: "League of Legends" });
    expect(team.title).toBe("My League of Legends Team");
    expect(team.offense.formation).toBe("11-singleback");
    expect(team.defense.formation).toBe("43-over");
    expect(team.offense.depth.WR).toEqual([null, null, null, null, null, null]);
    expect(team.defense.depth.DB).toEqual([null]);
    expect(team.defense.depth).not.toHaveProperty("NT");
  });

  it("builds the 3-4 rows for a 3-4 front", () => {
    const team = newTeam({ id: "x", ip: "X" }, "3-4");
    expect(team.defense.formation).toBe("34-okie");
    expect(team.defense.depth).toHaveProperty("NT");
    expect(team.defense.depth).not.toHaveProperty("LDT");
  });
});

describe("atRef", () => {
  it("reads 1-based depth spots", () => {
    const team = newTeam({ id: "x", ip: "X" });
    team.offense.depth.WR![2] = "Ahri";
    expect(atRef(team.offense.depth, { pos: "WR", depth: 3 })).toBe("Ahri");
    expect(atRef(team.offense.depth, { pos: "WR", depth: 1 })).toBeNull();
  });
});
