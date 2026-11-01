import type { ListSummary } from "@ftp/shared";
import { useCallback, useState } from "react";
import { loadBrowse, loadList, MissingList, SEED_LISTS, summarize, type LoadedList } from "./lists";
import { ownedListIds } from "./ownership";
import { Sprite } from "./Sprite";
import { useResource } from "./useResource";
import { ShareLink } from "./ShareMenu";
import { SportPicker, setUrlSport, sportQuery, urlSport } from "./SportPicker";

export const normalizeSearch = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
const fetchBrowse = (signal: AbortSignal) => loadBrowse(signal);

export function Catalog({ browse = false }: { browse?: boolean }) {
  const { value, error, retry } = useResource(fetchBrowse);
  const [query, setQuery] = useState(new URLSearchParams(location.search).get("q") ?? "");
  const [sort, setSort] = useState("recent");
  const [sport, setSport] = useState(urlSport);
  const seeds = SEED_LISTS.map(summarize);
  const publicLists = (value ?? []).filter((l) => !seeds.some((s) => s.id === l.id));
  const search = normalizeSearch(query);
  const matches = [...seeds, ...publicLists].filter((l) =>
    [l.ip, l.title].some((text) => normalizeSearch(text).includes(search)),
  );
  matches.sort((a, b) => {
    const seedOrder =
      Number(seeds.some((l) => l.id === b.id)) - Number(seeds.some((l) => l.id === a.id));
    return (
      seedOrder ||
      (sort === "title"
        ? a.title.localeCompare(b.title)
        : sort === "ip"
          ? a.ip.localeCompare(b.ip)
          : b.createdAt.localeCompare(a.createdAt))
    );
  });
  function searchChanged(q: string) {
    setQuery(q);
    if (browse) {
      const url = new URL(location.href);
      if (q) url.searchParams.set("q", q);
      else url.searchParams.delete("q");
      history.replaceState(null, "", url);
    }
  }
  return (
    <section className="catalog">
      <h2>{browse ? "Browse character lists" : "Pick a game. Build your team."}</h2>
      <p>
        Turn your favorite characters into a depth chart for football, soccer, basketball, hockey or
        baseball, then export your lineup.
      </p>
      <SportPicker
        value={sport}
        onChange={(next) => {
          setSport(next);
          setUrlSport(next);
        }}
      />
      <form action="/browse" role="search" className="catalog-search">
        <label htmlFor="game-search">Pick a game</label>
        <input
          id="game-search"
          type="search"
          name="q"
          placeholder="Search games or list titles"
          value={query}
          onChange={(e) => searchChanged(e.target.value)}
        />
        <button>Search</button>
        <a href="/new">Create your own list</a>
      </form>
      {browse && (
        <label>
          Sort by{" "}
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="recent">Newest</option>
            <option value="title">List title</option>
            <option value="ip">Game / IP</option>
          </select>
        </label>
      )}
      {!value && !error && <p role="status">Loading community lists…</p>}
      {error && (
        <p role="alert">
          {error.message} <button onClick={retry}>Retry</button>
        </p>
      )}
      {browse || query ? (
        <>
          <h3>Character lists</h3>
          {matches.length ? (
            <Cards lists={matches} sport={sport} />
          ) : (
            <p>No lists match “{query}”. Try another game or create a list.</p>
          )}
        </>
      ) : (
        <>
          <h3>Featured lists</h3>
          <Cards lists={seeds} sport={sport} />
          <h3>Recent public lists</h3>
          {publicLists.length ? (
            <Cards lists={publicLists.slice(0, 12)} sport={sport} />
          ) : (
            value && <p>No community lists yet. Yours could be the first.</p>
          )}
          <a href="/browse">Browse all lists</a>
        </>
      )}
      <MyLists />
    </section>
  );
}

function Cards({ lists, sport }: { lists: ListSummary[]; sport: string }) {
  return (
    <div className="list-cards">
      {lists.map((list) => (
        <article key={list.id} className="list-card">
          <a href={`/l/${list.id}${sportQuery(sport)}`}>
            <div className="list-cover" aria-hidden="true">
              {list.cover.map((index, i) => (
                <Sprite
                  key={i}
                  list={{ atlas: list.atlas, atlasUrl: list.atlas.src }}
                  index={index}
                  size={64}
                />
              ))}
            </div>
            <h4>{list.title}</h4>
          </a>
          <p>
            {list.ip} · {list.count} characters · {list.twoWayCount} two-way
          </p>
          {list.disclaimer && <p className="card-disclaimer">{list.disclaimer}</p>}
        </article>
      ))}
    </div>
  );
}

function MyLists() {
  const [ids] = useState(ownedListIds);
  return (
    ids.length > 0 && (
      <section>
        <h3>My lists</h3>
        <p>Edit links saved in this browser.</p>
        <ul>
          {ids.map((id) => (
            <OwnedList key={id} id={id} />
          ))}
        </ul>
      </section>
    )
  );
}
function OwnedList({ id }: { id: string }) {
  const load = useCallback((signal: AbortSignal) => loadList(id, signal), [id]);
  const { value, error } = useResource(load);
  return (
    <li>
      <a href={`/l/${id}/edit`}>
        {value?.title ?? (error ? `Unavailable list (${id})` : "Loading list…")}
      </a>
    </li>
  );
}

export function ListPage({
  id,
  build,
  renderBuilder,
}: {
  id: string;
  build: boolean;
  renderBuilder: (list: LoadedList) => React.ReactNode;
}) {
  const load = useCallback((signal: AbortSignal) => loadList(id, signal), [id]);
  const { value: list, error, retry } = useResource(load);
  if (error instanceof MissingList) return <NotFound />;
  if (error)
    return (
      <p role="alert">
        Could not load this list. <button onClick={retry}>Retry</button>
      </p>
    );
  if (!list) return <p role="status">Loading list…</p>;
  if (build) return renderBuilder(list);
  return (
    <section className="catalog">
      <h2>{list.title}</h2>
      <ShareLink url={`${location.origin}/l/${list.id}`} />
      <p>
        {list.ip} · {list.characters.length} characters ·{" "}
        {list.characters.filter((c) => c.twoWay).length} two-way
      </p>
      <p>{list.description}</p>
      <div className="actions">
        <a className="button-link" href={`/build/${list.id}${sportQuery(urlSport())}`}>
          Build a team
        </a>
        <a href={`/new?remix=${list.id}`}>Remix list</a>
        <a href={`/report?type=list&id=${list.id}`}>Report</a>
      </div>
      <div className="list-portraits">
        {list.characters.map((c) => (
          <div key={c.id}>
            <Sprite list={list} index={c.atlasIndex} size={64} />
            <span>
              {c.name}
              {c.twoWay ? " · 2W" : ""}
            </span>
          </div>
        ))}
      </div>
      {list.disclaimer && <p className="card-disclaimer">{list.disclaimer}</p>}
    </section>
  );
}

export function NotFound() {
  return (
    <section className="catalog">
      <h2>Page not found</h2>
      <p>This link may have been removed or hidden.</p>
      <a href="/browse">Find a character list</a>
    </section>
  );
}
