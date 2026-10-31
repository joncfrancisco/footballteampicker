/** Shared with the list editor: tokens stay local and never appear in public links. */
const PREFIX = "ftp:edit:";
export function editToken(id: string): string | undefined {
  try {
    return localStorage.getItem(`${PREFIX}${id}`) ?? undefined;
  } catch {
    return undefined;
  }
}
export function ownedListIds(): string[] {
  try {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX) && localStorage.getItem(k))
      .map((k) => k.slice(PREFIX.length))
      .filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id));
  } catch {
    return [];
  }
}
export function rememberList(id: string, token: string) {
  try {
    localStorage.setItem(`${PREFIX}${id}`, token);
  } catch {
    /* The edit link still works. */
  }
}
