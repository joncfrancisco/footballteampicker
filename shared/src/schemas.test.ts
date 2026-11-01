import { describe, expect, it } from "vitest";
import { moveInOrder, place, setSection } from "./lineup";
import { ListInput, TeamInput, teamErrors } from "./schemas";
import { newTeam, type Team } from "./team";

const roster = new Map([
  ["ahri", { name: "Ahri", twoWay: false }],
  ["braum", { name: "Braum", twoWay: true }],
]);

const parsed = (t: unknown) => TeamInput.parse(t) as Team;

/** A football team as every client sent it before #44. */
const V1 = {
  title: "Old",
  listId: "demo-lol",
  offense: {
    depth: newTeam({ id: "demo-lol", ip: "X" }).units.offense!.depth,
    formation: "10-spread",
    qb: "under",
  },
  defense: {
    front: "3-4",
    depth: newTeam({ id: "demo-lol", ip: "X" }, "football", { defense: "3-4" }).units.defense!
      .depth,
    formation: "34-dime",
  },
  specialTeams: {
    K: ["ahri"],
    P: [null],
    LS: [null],
    H: [null],
    KR: [null, null],
    PR: [null, null],
  },
  staff: { HC: "braum", OC: null, DC: null, STC: null, GM: null },
};

describe("v1 team bodies (#44)", () => {
  it("are still accepted, upgraded to football v2", () => {
    const t = parsed(V1);
    expect(t).toMatchObject({
      schemaVersion: 2,
      sport: "football",
      units: {
        offense: { formation: "10-spread", align: "under" },
        defense: { formation: "34-dime", variant: "3-4" },
      },
      sections: { specialTeams: { K: ["ahri"] }, staff: { HC: ["braum"] } },
    });
    expect(t).not.toHaveProperty("offense");
    expect(teamErrors(t, roster)).toEqual([]);
  });
});

describe("TeamInput + teamErrors", () => {
  it("accepts a builder team, sections and all", () => {
    let t = setSection(
      setSection(newTeam({ id: "demo-lol", ip: "X" }), "specialTeams", true),
      "staff",
      true,
    );
    const r = place(t, roster, "ahri", { side: "offense", pos: "QB", index: 0 });
    if (!r.ok) throw new Error(r.reason);
    t = r.team;
    expect(teamErrors(parsed(t), roster)).toEqual([]);
  });

  it("accepts a baseball team with a moved batting order (#75)", () => {
    const t = moveInOrder(newTeam({ id: "demo-lol", ip: "X" }, "baseball"), "hitters", "C", -1);
    expect(t.units.hitters!.order).toEqual(["CF", "SS", "1B", "DH", "3B", "RF", "LF", "C", "2B"]);
    const back = parsed(JSON.parse(JSON.stringify(t)));
    expect(back.units.hitters!.order).toEqual(t.units.hitters!.order);
    expect(teamErrors(back, roster)).toEqual([]);
    const bad = structuredClone(t);
    bad.units.hitters!.order = ["../x"];
    expect(TeamInput.safeParse(bad).success).toBe(false);
  });

  it("strips control characters and caps the title", () => {
    const t = { ...newTeam({ id: "demo-lol", ip: "X" }), title: " A\u0000B\u0007 " };
    expect(TeamInput.parse(t).title).toBe("AB");
    expect(TeamInput.safeParse({ ...t, title: "x".repeat(81) }).success).toBe(false);
    expect(TeamInput.safeParse({ ...t, title: "\u0001" }).success).toBe(false);
  });

  it("rejects unknown keys and bad ids", () => {
    const t = newTeam({ id: "demo-lol", ip: "X" });
    expect(TeamInput.safeParse({ ...t, offense: t.units.offense }).success).toBe(false);
    expect(
      TeamInput.safeParse({
        ...V1,
        staff: { HC: null, OC: null, DC: null, STC: null, GM: null, XX: null },
      }).success,
    ).toBe(false);
    expect(teamErrors({ ...t, sections: { staff: { XX: [null] } } }, roster)).toContain(
      "staff has no XX row",
    );
    expect(TeamInput.safeParse({ ...t, listId: "../etc" }).success).toBe(false);
  });

  it("runs the builder's rules: formations, front, shapes, lineup", () => {
    const t = newTeam({ id: "demo-lol", ip: "X" });
    expect(
      teamErrors(
        { ...t, units: { ...t.units, defense: { ...t.units.defense!, formation: "34-okie" } } },
        roster,
      ),
    ).toContain('"34-okie" isn\'t a 4-3 formation');
    expect(
      teamErrors(
        { ...t, units: { ...t.units, offense: { ...t.units.offense!, formation: "nope" } } },
        roster,
      ),
    ).toContain('Unknown offense formation "nope"');
    expect(
      teamErrors(
        {
          ...t,
          units: {
            ...t.units,
            offense: { ...t.units.offense!, formation: "21-i-pro", align: "gun" },
          },
        },
        roster,
      ),
    ).toContain("I-Formation Pro has no gun option");
    const { formation: _f, ...noFormation } = t.units.defense!;
    expect(teamErrors({ ...t, units: { ...t.units, defense: noFormation } }, roster)).toContain(
      "Missing defense formation",
    );
    const twice = structuredClone(t);
    twice.units.offense!.depth.QB![0] = "ahri";
    twice.units.defense!.depth.MLB![0] = "ahri";
    expect(teamErrors(twice, roster)).toEqual(["Ahri isn't a two-way player"]);
  });
});

describe("ListInput", () => {
  const list = {
    title: "My Roster",
    ip: "Some Game",
    atlas: { key: "m/a/abc123.webp", tile: 120, columns: 16, count: 11 },
    characters: Array.from({ length: 11 }, (_, i) => ({
      id: `c${i}`,
      name: `C${i}`,
      atlasIndex: i,
    })),
  };

  it("fills defaults", () => {
    const l = ListInput.parse(list);
    expect(l.visibility).toBe("unlisted");
    expect(l.characters[0]).toMatchObject({ twoWay: false, tags: [] });
  });

  it("rejects duplicates, tiles outside the atlas, foreign atlas keys and >150 characters", () => {
    expect(
      ListInput.safeParse({ ...list, characters: [list.characters[0], list.characters[0]] })
        .success,
    ).toBe(false);
    expect(
      ListInput.safeParse({ ...list, characters: [{ ...list.characters[0], atlasIndex: 5 }] })
        .success,
    ).toBe(false);
    expect(
      ListInput.safeParse({ ...list, atlas: { ...list.atlas, key: "https://evil/x.webp" } })
        .success,
    ).toBe(false);
    const many = Array.from({ length: 151 }, (_, i) => ({
      id: `c${i}`,
      name: `C${i}`,
      atlasIndex: 0,
    }));
    expect(ListInput.safeParse({ ...list, characters: many }).success).toBe(false);
  });
});
