import { DEFAULT_SPORT, SPORTS, sportById } from "@ftp/shared";

/** ?sport= carries the chosen sport from home and browse to the builder; football by default. */
export function urlSport(): string {
  return (
    sportById(new URLSearchParams(location.search).get("sport") ?? undefined)?.id ?? DEFAULT_SPORT
  );
}

/** Put the sport in the URL (leaving it out for football), dropping `drop` params. */
export function setUrlSport(sport: string, drop: string[] = []) {
  const url = new URL(location.href);
  if (sport === DEFAULT_SPORT) url.searchParams.delete("sport");
  else url.searchParams.set("sport", sport);
  for (const p of drop) url.searchParams.delete(p);
  history.replaceState(null, "", url);
}

/** `?sport=<id>` to add to a link, or "" for football. */
export function sportQuery(sport: string): string {
  return sport === DEFAULT_SPORT ? "" : `?sport=${sport}`;
}

/** Pick the sport first: the team, field, rules and formations all follow it (#44). */
export function SportPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (sport: string) => void;
}) {
  return (
    <div className="sport-picker" role="radiogroup" aria-label="Sport">
      {SPORTS.map((s) => (
        <button
          key={s.id}
          type="button"
          role="radio"
          aria-checked={s.id === value}
          onClick={() => s.id !== value && onChange(s.id)}
        >
          {s.name}
        </button>
      ))}
    </div>
  );
}
