import { newTeam } from "@ftp/shared";
import { afterEach, describe, expect, it } from "vitest";
import { draftKey, loadDraft, saveDraft } from "./draft";
import { SEED_LISTS } from "./lists";

const list = SEED_LISTS[0]!;
afterEach(() => localStorage.clear());

describe("drafts (#44)", () => {
  it("keep football's pre-#44 key, so existing drafts survive", () => {
    expect(draftKey("demo-lol", "football")).toBe("ftp:draft:demo-lol");
    expect(draftKey("demo-lol", "soccer")).toBe("ftp:draft:demo-lol:soccer");
  });

  it("upgrade a v1 football draft on load", () => {
    const v2 = newTeam(list);
    const v1 = {
      title: "Old draft",
      listId: list.id,
      offense: { depth: v2.units.offense!.depth, formation: "10-spread" },
      defense: { front: "4-3", depth: v2.units.defense!.depth, formation: "43-over" },
    };
    localStorage.setItem("ftp:draft:demo-lol", JSON.stringify(v1));
    expect(loadDraft(list)).toMatchObject({
      sport: "football",
      title: "Old draft",
      units: { offense: { formation: "10-spread" } },
    });
  });

  it("round-trip per sport", () => {
    const team = { ...newTeam(list), title: "Saved" };
    saveDraft(team);
    expect(loadDraft(list, "football")?.title).toBe("Saved");
  });
});
