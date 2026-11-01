import lol from "../../seed/league-of-legends/list.json";
import { CharacterList, SPORTS, autoFill, newTeam, setSection, type Team } from "@ftp/shared";
import { expect, it } from "vitest";

/**
 * #44 must stay inside the #18 budget: a full team of any sport, every section on, is no
 * bigger than a full football team, which INFRA.md sizes at ~1.1 KB (2 WRU).
 */
const seed = CharacterList.parse(lol);
const ids = seed.characters.map((c) => c.id);

function full(sport: string): Team {
  const team = SPORTS.find((s) => s.id === sport)!.sections.reduce(
    (t, s) => setSection(t, s.id, true),
    newTeam(seed, sport),
  );
  // Fill sections with the same names as the units: size is what's measured here.
  const filled = autoFill(team, ids);
  let i = 0;
  const sections = Object.fromEntries(
    Object.entries(filled.sections ?? {}).map(([id, depth]) => [
      id,
      Object.fromEntries(
        Object.entries(depth).map(([pos, row]) => [pos, row.map(() => ids[i++]!)]),
      ),
    ]),
  );
  return { ...filled, sections };
}

const size = (t: Team) => Buffer.byteLength(JSON.stringify({ ...t, listVersion: 1 }));
const football = size(full("football"));

it.each(SPORTS.map((s) => s.id))("a full %s team fits the football budget", (sport) => {
  const bytes = size(full(sport));
  expect(bytes).toBeLessThanOrEqual(football);
  expect(bytes).toBeLessThan(2048);
});
