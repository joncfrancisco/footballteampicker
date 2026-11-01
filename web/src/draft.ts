import { teamErrors, upgradeTeam, type Team } from "@ftp/shared";
import type { LoadedList } from "./lists";

/** The builder's work in progress, one per list, so a refresh loses nothing. */
const key = (listId: string) => `ftp:draft:${listId}`;

export function loadDraft(list: LoadedList): Team | null {
  try {
    const raw = localStorage.getItem(key(list.id));
    if (!raw) return null;
    // Drafts saved before #44 are football v1.
    const team = upgradeTeam(JSON.parse(raw) as Team);
    const valid =
      team?.listId === list.id &&
      typeof team.title === "string" &&
      teamErrors(team, list.byId).length === 0;
    return valid ? team : null;
  } catch {
    return null;
  }
}

export function saveDraft(team: Team): void {
  try {
    localStorage.setItem(key(team.listId), JSON.stringify(team));
  } catch {
    // Private mode or full storage: the builder still works, it just won't survive a refresh.
  }
}
