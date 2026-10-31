import { describe, expect, it } from "vitest";
import { place, setSection } from "./lineup";
import { ListInput, TeamInput, teamErrors } from "./schemas";
import { newTeam, type Team } from "./team";

const roster = new Map([
  ["ahri", { name: "Ahri", twoWay: false }],
  ["braum", { name: "Braum", twoWay: true }],
]);

const parsed = (t: unknown) => TeamInput.parse(t) as Team;

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

  it("strips control characters and caps the title", () => {
    const t = { ...newTeam({ id: "demo-lol", ip: "X" }), title: " A\u0000B\u0007 " };
    expect(TeamInput.parse(t).title).toBe("AB");
    expect(TeamInput.safeParse({ ...t, title: "x".repeat(81) }).success).toBe(false);
    expect(TeamInput.safeParse({ ...t, title: "\u0001" }).success).toBe(false);
  });

  it("rejects unknown keys in staff and bad ids", () => {
    const t = newTeam({ id: "demo-lol", ip: "X" });
    expect(
      TeamInput.safeParse({
        ...t,
        staff: { HC: null, OC: null, DC: null, STC: null, GM: null, XX: null },
      }).success,
    ).toBe(false);
    expect(TeamInput.safeParse({ ...t, listId: "../etc" }).success).toBe(false);
  });

  it("runs the builder's rules: formations, front, shapes, lineup", () => {
    const t = newTeam({ id: "demo-lol", ip: "X" });
    expect(teamErrors({ ...t, defense: { ...t.defense, formation: "34-okie" } }, roster)).toContain(
      '"34-okie" isn\'t a 4-3 formation',
    );
    expect(teamErrors({ ...t, offense: { ...t.offense, formation: "nope" } }, roster)).toContain(
      'Unknown offensive formation "nope"',
    );
    expect(
      teamErrors({ ...t, offense: { ...t.offense, formation: "21-i-pro", qb: "gun" } }, roster),
    ).toContain("I-Formation Pro has no gun option");
    const twice = structuredClone(t);
    twice.offense.depth.QB![0] = "ahri";
    twice.defense.depth.MLB![0] = "ahri";
    expect(teamErrors(twice, roster)).toEqual(["Ahri isn't a two-way player"]);
  });
});

describe("ListInput", () => {
  const list = {
    title: "My Roster",
    ip: "Some Game",
    atlas: { key: "m/a/abc123.webp", tile: 120, columns: 16, count: 2 },
    characters: [
      { id: "a", name: "A" },
      { id: "b", name: "B", twoWay: true, atlasIndex: 1 },
    ].map((c, i) => ({ atlasIndex: i, ...c })),
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
