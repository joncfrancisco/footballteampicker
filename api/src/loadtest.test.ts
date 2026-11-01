import { writeFileSync } from "node:fs";
import {
  CharacterList,
  SPECIAL_TEAMS_ROWS,
  STAFF_ROLES,
  autoFill,
  newTeam,
  place,
  setSection,
  teamErrors,
  type Front,
  type Team,
} from "@ftp/shared";
import { expect, it } from "vitest";
import lol from "../../seed/league-of-legends/list.json";
import committed from "../../loadtest/teams.json";

/**
 * The k6 scripts (#18) post these teams. They're the heaviest a real user can build: every
 * depth spot, special teams and staff filled, one per front. Built here with the shared rules
 * so they stay valid; `UPDATE_LOADTEST=1 npx vitest run api/src/loadtest.test.ts` rewrites them.
 */
const seed = CharacterList.parse(lol);
const roster = new Map(seed.characters.map((c) => [c.id, c]));

function fullTeam(front: Front): Team {
  const order = seed.characters.map((c) => c.id);
  let team = autoFill(
    setSection(
      setSection(newTeam(seed, "football", { defense: front }), "specialTeams", true),
      "staff",
      true,
    ),
    order,
  );
  const fill = (side: "specialTeams" | "staff", pos: string, index: number, id: string) => {
    const r = place(team, roster, id, { side, pos, index });
    if (!r.ok) throw new Error(`${side} ${pos}: ${r.reason}`);
    team = r.team;
  };
  // Special teams reuse starters (allowed on top of a regular spot); staff are bench names.
  const starters = Object.values(team.units.offense!.depth).map((row) => row[0]!);
  let s = 0;
  for (const [pos, n] of Object.entries(SPECIAL_TEAMS_ROWS))
    for (let i = 0; i < n; i++) fill("specialTeams", pos, i, starters[s++ % starters.length]!);
  const playing = new Set(
    Object.values({ ...team.units.offense!.depth, ...team.units.defense!.depth }).flat(),
  );
  const coaches = order.filter((id) => !playing.has(id));
  STAFF_ROLES.forEach((role, i) => fill("staff", role, 0, coaches[i]!));
  return { ...team, title: `Load test ${front}` };
}

const built = { listId: seed.id, teams: [fullTeam("4-3"), fullTeam("3-4")] };

it("load-test teams are full and valid against the shared rules", () => {
  if (process.env.UPDATE_LOADTEST)
    writeFileSync(
      new URL("../../loadtest/teams.json", import.meta.url),
      JSON.stringify(built, null, 2) + "\n",
    );
  for (const team of built.teams) {
    expect(teamErrors(team, roster)).toEqual([]);
    expect(Object.values(team.units.offense!.depth).flat()).not.toContain(null);
    expect(Object.values(team.units.defense!.depth).flat()).not.toContain(null);
    expect(Object.values(team.sections!.staff!).flat()).not.toContain(null);
  }
  expect(committed).toEqual(JSON.parse(JSON.stringify(built)));
});
