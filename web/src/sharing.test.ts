import { newTeam, setSection, type PublishedTeam } from "@ftp/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SEED_LISTS } from "./lists";
import { loadTeam, remixTeam, snapshotList } from "./sharing";

const list = SEED_LISTS[0]!;
export function savedTeam(): PublishedTeam {
  const team = setSection(setSection(newTeam(list), "staff", true), "specialTeams", true);
  team.offense.depth.QB![0] = "Ahri";
  team.defense.depth.FS![0] = "Ahri";
  team.staff!.HC = "Zed";
  team.specialTeams!.KR![0] = "Ahri";
  return {
    ...team,
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
afterEach(() => vi.unstubAllGlobals());
describe("shared teams", () => {
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
    expect(team.offense.depth.QB![0]).toBe("Ahri");
    expect(team.defense.depth.FS![0]).toBeNull();
    expect(team.specialTeams!.KR![0]).toBe("Ahri");
    expect(team.staff!.HC).toBeNull();
    expect(notices.join(" ")).toMatch(/no longer two-way/);
    expect(notices.join(" ")).toMatch(/Missing.*Zed/);
    expect(saved.defense.depth.FS![0]).toBe("Ahri");
  });
  it("rejects malformed or off-origin media in published teams", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...savedTeam(),
            atlas: { ...list.atlas, src: "https://elsewhere.invalid/atlas.webp" },
          }),
        ),
      ),
    );
    await expect(loadTeam("shared1234")).rejects.toThrow("Invalid media URL");
  });
});
