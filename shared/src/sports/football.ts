import { DEFAULT_DEFENSE, DEFAULT_OFFENSE, FORMATIONS } from "../formations";
import {
  DEFENSE_ROWS,
  OFFENSE_ROWS,
  SPECIAL_TEAMS_ROWS,
  STAFF_ROLES,
  STAFF_TITLES,
} from "../positions";
import type { SportDef } from "../sport";

const one = (roles: readonly string[]) => Object.fromEntries(roles.map((r) => [r, 1]));

export const FOOTBALL: SportDef = {
  id: "football",
  name: "Football",
  surface: "gridiron",
  units: [
    {
      id: "offense",
      name: "Offense",
      short: "O",
      variants: [{ id: "base", name: "Offense", rows: OFFENSE_ROWS }],
      defaultFormation: { base: DEFAULT_OFFENSE },
    },
    {
      id: "defense",
      name: "Defense",
      short: "D",
      variantLabel: "Front",
      variants: [
        { id: "4-3", name: "4-3", rows: DEFENSE_ROWS["4-3"] },
        { id: "3-4", name: "3-4", rows: DEFENSE_ROWS["3-4"] },
      ],
      // LDT ↔ NT, and the linebackers in order (WLB, MLB, SLB ↔ LOLB, LILB, RILB, ROLB).
      variantMap: {
        "4-3": { "3-4": { LDT: "NT", WLB: "LOLB", MLB: "LILB", SLB: "RILB" } },
        "3-4": { "4-3": { NT: "LDT", LOLB: "WLB", LILB: "MLB", RILB: "SLB" } },
      },
      defaultFormation: DEFAULT_DEFENSE,
    },
  ],
  sections: [
    {
      id: "specialTeams",
      name: "Special teams",
      short: "ST",
      kind: "situational",
      rows: SPECIAL_TEAMS_ROWS,
      pairs: [["KR", "PR"]],
    },
    {
      id: "staff",
      name: "Staff",
      short: "Staff",
      kind: "staff",
      rows: one(STAFF_ROLES),
      titles: STAFF_TITLES,
    },
  ],
  formations: FORMATIONS,
};
