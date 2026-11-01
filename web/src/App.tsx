import { SPORTS, newTeam, type Team } from "@ftp/shared";
import { useEffect, useState } from "react";
import { Builder } from "./Builder";
import { demoTeam } from "./demo";
import { loadDraft, saveDraft } from "./draft";
import { SEED_LISTS } from "./lists";
import type { LoadedList } from "./lists";
import { Catalog, ListPage, NotFound } from "./Catalog";
import { TeamPage, RemixBuilder } from "./TeamPage";
import { ShareMenu } from "./ShareMenu";
import { SportPicker, setUrlSport, urlSport } from "./SportPicker";
import { EditorPage } from "./editor/Editor";
import { About, ReportPage } from "./Policy";

// ?fill=demo (&sections=1) is for screenshots and checks; it never touches the saved draft.
const params = () => new URLSearchParams(window.location.search);
const isDemo = () => params().get("fill") === "demo";

export function App() {
  const path = window.location.pathname;
  const match = path.match(/^\/(l|build)\/([A-Za-z0-9_-]{1,64})\/?$/);
  const demo = path === "/" && isDemo();
  const seedBuilder = match?.[1] === "build" && SEED_LISTS.find((l) => l.id === match[2]);
  const shared = path.match(/^\/t\/([A-Za-z0-9]{10})\/?$/);
  const editing = path.match(/^\/l\/([A-Za-z0-9_-]{1,64})\/edit\/?$/);
  const remix = match?.[1] === "build" && params().get("remix");
  return (
    <>
      <header className="site-header">
        <h1>
          <a href="/">Depth Chart</a>
        </h1>
        <nav aria-label="Main">
          <a href="/browse">Browse lists</a>
        </nav>
      </header>
      <main>
        {path === "/about" ? (
          <About />
        ) : path === "/report" ? (
          <ReportPage />
        ) : path === "/new" ? (
          <EditorPage remix={params().get("remix") ?? undefined} />
        ) : editing ? (
          <EditorPage id={editing[1]!} />
        ) : shared ? (
          <TeamPage id={shared[1]!} />
        ) : remix && /^[A-Za-z0-9]{10}$/.test(remix) ? (
          <RemixBuilder
            id={remix}
            listId={match![2]!}
            render={(list, team, notices) => (
              <TeamBuilder list={list} initial={team} notices={notices} />
            )}
          />
        ) : demo || seedBuilder ? (
          <TeamBuilder list={seedBuilder || SEED_LISTS[0]!} />
        ) : path === "/" || path === "/browse" ? (
          <Catalog browse={path === "/browse"} />
        ) : match ? (
          <ListPage
            key={match[2]}
            id={match[2]!}
            build={match[1] === "build"}
            renderBuilder={(list) => <TeamBuilder key={list.id} list={list} />}
          />
        ) : (
          <NotFound />
        )}
      </main>
      <footer className="disclaimer">
        <p>
          <a href="/about">About &amp; content rules</a>
        </p>
        {SEED_LISTS[0]!.disclaimer}
      </footer>
    </>
  );
}

function TeamBuilder({
  list,
  initial,
  notices = [],
}: {
  list: LoadedList;
  initial?: Team;
  notices?: string[];
}) {
  const [demo] = useState(isDemo);
  const start = (sport: string): Team =>
    demo
      ? demoTeam(list, { sections: params().get("sections") === "1", sport })
      : (loadDraft(list, sport) ?? newTeam(list, sport));
  const [team, setTeam] = useState<Team>(() => initial ?? start(urlSport()));

  useEffect(() => {
    if (!demo) saveDraft(team);
  }, [demo, team]);

  /** Each sport keeps its own draft; the URL says which one is open (/build/<list>?sport=). */
  const pickSport = (sport: string) => {
    setUrlSport(sport, ["remix"]);
    setTeam(start(sport));
  };

  return (
    <>
      <p className="list-name">
        <a href={`/l/${list.id}`}>{list.title}</a>
      </p>
      {notices.length > 0 && (
        <div role="status">
          {notices.map((notice) => (
            <p key={notice}>{notice}</p>
          ))}
        </div>
      )}
      {SPORTS.length > 1 && <SportPicker value={team.sport} onChange={pickSport} />}
      <Builder list={list} team={team} onChange={setTeam}>
        <ShareMenu list={list} team={team} />
      </Builder>
      {list.disclaimer && list.id !== SEED_LISTS[0]!.id && (
        <p className="disclaimer">{list.disclaimer}</p>
      )}
    </>
  );
}
