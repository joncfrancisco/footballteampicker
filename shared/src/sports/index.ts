import type { SportDef } from "../sport";
import { BASKETBALL } from "./basketball";
import { FOOTBALL } from "./football";
import { HOCKEY } from "./hockey";
import { SOCCER } from "./soccer";

/** Every sport the builder offers, in picker order. Football is the default. */
export const SPORTS: readonly SportDef[] = [FOOTBALL, SOCCER, BASKETBALL, HOCKEY];
export const SPORT_IDS = SPORTS.map((s) => s.id) as [string, ...string[]];
export const DEFAULT_SPORT = "football";

export function sportById(id: string | undefined): SportDef | undefined {
  return SPORTS.find((s) => s.id === id);
}

/** The sport of a team, which must be registered (validation guarantees it). */
export function sportOf(team: { sport: string }): SportDef {
  const sport = sportById(team.sport);
  if (!sport) throw new Error(`Unknown sport "${team.sport}"`);
  return sport;
}

export { BASKETBALL, FOOTBALL, HOCKEY, SOCCER };
