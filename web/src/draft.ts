import { formationById, shapeErrors, violations, type Team } from "@ftp/shared";
import type { LoadedList } from "./lists";

/** The builder's work in progress, one per list, so a refresh loses nothing. */
const key = (listId: string) => `ftp:draft:${listId}`;

export function loadDraft(list: LoadedList): Team | null {
  try {
    const raw = localStorage.getItem(key(list.id));
    if (!raw) return null;
    const team = JSON.parse(raw) as Team;
    const valid =
      team?.listId === list.id &&
      typeof team.title === "string" &&
      formationById(team.offense?.formation)?.side === "offense" &&
      formationById(team.defense?.formation)?.front === team.defense?.front &&
      shapeErrors(team).length === 0 &&
      violations(team, list.byId).length === 0;
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
