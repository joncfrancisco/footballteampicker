import {
  DEFENSE_ROWS,
  OFFENSE_ROWS,
  PublishedTeam,
  SPECIAL_TEAMS_ROWS,
  emptyDepth,
} from "@ftp/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SEED_LISTS } from "./lists";
import { loadTeam, remixTeam, snapshotList } from "./sharing";

const list = SEED_LISTS[0]!;
/**
 * A team exactly as published before #44 (schema 1, football only). Every link to one of these
 * must keep working, so this is the raw JSON, read the way the team page reads it.
 */
export function savedV1Json() {
  const offense = emptyDepth(OFFENSE_ROWS);
  const defense = emptyDepth(DEFENSE_ROWS["4-3"]);
  const specialTeams = emptyDepth(SPECIAL_TEAMS_ROWS);
  offense.QB![0] = "Ahri";
  defense.FS![0] = "Ahri";
  specialTeams.KR![0] = "Ahri";
  return {
    title: "My League of Legends Team",
    listId: list.id,
    offense: { depth: offense, formation: "11-shotgun-trips", qb: "under" },
    defense: { front: "4-3", depth: defense, formation: "43-nickel" },
    specialTeams,
    staff: { HC: "Zed", OC: null, DC: null, STC: null, GM: null },
    schema: 1,
    id: "shared1234",
    listVersion: 0,
    listTitle: list.title,
    atlas: { ...list.atlas, src: `/m/seeds/${list.id}/${list.atlas.src}` },
    characters: {
      Ahri: { name: "Original Ahri", twoWay: true, atlasIndex: list.byId.get("Ahri")!.atlasIndex },
      Zed: { name: "Zed", twoWay: false, atlasIndex: list.byId.get("Zed")!.atlasIndex },
    },
    createdAt: "2026-10-31",
  };
}
export function savedTeam(): PublishedTeam {
  return PublishedTeam.parse(savedV1Json());
}
afterEach(() => vi.unstubAllGlobals());
describe("shared teams", () => {
  it("reads a schema 1 (football v1) team as football v2, formations and all (#44)", () => {
    const saved = savedTeam();
    expect(saved).toMatchObject({
      schemaVersion: 2,
      sport: "football",
      units: {
        offense: { formation: "11-shotgun-trips", align: "under" },
        defense: { formation: "43-nickel", variant: "4-3" },
      },
      sections: { staff: { HC: ["Zed"] } },
    });
  });
  it("uses only the immutable snapshot for display", () => {
    const saved = savedTeam();
    const snapshot = snapshotList(saved);
    expect(snapshot.byId.get("Ahri")?.name).toBe("Original Ahri");
    expect(snapshot.byId.get("Ahri")?.twoWay).toBe(true);
    expect(snapshot.atlasUrl).toBe(saved.atlas.src);
  });
  it("remixes against current flags, preserves offense, clears removed characters in every section", () => {
    const saved = savedTeam();
    const current = { ...list, byId: new Map([...list.byId].filter(([id]) => id !== "Zed")) };
    const { team, notices } = remixTeam(saved, current);
    expect(team.units.offense!.depth.QB![0]).toBe("Ahri");
    expect(team.units.defense!.depth.FS![0]).toBeNull();
    expect(team.sections!.specialTeams!.KR![0]).toBe("Ahri");
    expect(team.sections!.staff!.HC).toEqual([null]);
    expect(notices.join(" ")).toMatch(/no longer two-way. Kept offense and cleared defense/);
    expect(notices.join(" ")).toMatch(/Missing.*Zed/);
    expect(saved.units.defense!.depth.FS![0]).toBe("Ahri");
  });
  it("rejects malformed or off-origin media in published teams", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...savedV1Json(),
            atlas: { ...list.atlas, src: "https://elsewhere.invalid/atlas.webp" },
          }),
        ),
      ),
    );
    await expect(loadTeam("shared1234")).rejects.toThrow("Invalid media URL");
  });
});
