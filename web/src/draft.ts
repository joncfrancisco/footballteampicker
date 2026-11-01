import { teamErrors, upgradeTeam, type Team } from "@ftp/shared";
import type { LoadedList } from "./lists";

/**
 * The builder's work in progress, one per list and sport, so a refresh loses nothing.
 * Football keeps the key it had before #44.
 */
export const draftKey = (listId: string, sport: string) =>
  sport === "football" ? `ftp:draft:${listId}` : `ftp:draft:${listId}:${sport}`;

export function loadDraft(list: LoadedList, sport = "football"): Team | null {
  try {
    const raw = localStorage.getItem(draftKey(list.id, sport));
    if (!raw) return null;
    // Drafts saved before #44 are football v1.
    const team = upgradeTeam(JSON.parse(raw) as Team);
    const valid =
      team?.listId === list.id &&
      team.sport === sport &&
      typeof team.title === "string" &&
      teamErrors(team, list.byId).length === 0;
    return valid ? team : null;
  } catch {
    return null;
  }
}

export function saveDraft(team: Team): void {
  try {
    localStorage.setItem(draftKey(team.listId, team.sport), JSON.stringify(team));
  } catch {
    // Private mode or full storage: the builder still works, it just won't survive a refresh.
  }
}
