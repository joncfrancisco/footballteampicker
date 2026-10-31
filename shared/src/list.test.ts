import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CharacterList } from "./list";

const seed = JSON.parse(
  readFileSync(new URL("../../seed/league-of-legends/list.json", import.meta.url), "utf8"),
);

describe("CharacterList", () => {
  it("accepts the League of Legends seed", () => {
    const list = CharacterList.parse(seed);
    expect(list.characters).toHaveLength(list.atlas.count);
    expect(list.disclaimer).toMatch(/Riot Games/);
  });

  it("rejects duplicate character ids", () => {
    const dup = { ...seed, characters: [seed.characters[0], seed.characters[0]] };
    expect(CharacterList.safeParse(dup).success).toBe(false);
  });

  it("rejects a tile outside the atlas", () => {
    const bad = { ...seed, characters: [{ ...seed.characters[0], atlasIndex: 9999 }] };
    expect(CharacterList.safeParse(bad).success).toBe(false);
  });
});
