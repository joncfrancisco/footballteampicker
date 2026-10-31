import { newTeam, type Team } from "@ftp/shared";
import { useEffect, useState } from "react";
import { Builder } from "./Builder";
import { demoTeam } from "./demo";
import { loadDraft, saveDraft } from "./draft";
import { SEED_LISTS } from "./lists";
import type { LoadedList } from "./lists";
import { Catalog, ListPage, NotFound } from "./Catalog";

// ?fill=demo (&sections=1) is for screenshots and checks; it never touches the saved draft.
const params = () => new URLSearchParams(window.location.search);
const isDemo = () => params().get("fill") === "demo";

export function App() {
  const path = window.location.pathname;
  const match = path.match(/^\/(l|build)\/([A-Za-z0-9_-]{1,64})\/?$/);
  const demo = path === "/" && isDemo();
  const seedBuilder = match?.[1] === "build" && SEED_LISTS.find((l) => l.id === match[2]);
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
        {demo || seedBuilder ? (
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
      <footer className="disclaimer">{SEED_LISTS[0]!.disclaimer}</footer>
    </>
  );
}

function TeamBuilder({ list }: { list: LoadedList }) {
  const [demo] = useState(isDemo);
  const [team, setTeam] = useState<Team>(() =>
    demo
      ? demoTeam(list, { sections: params().get("sections") === "1" })
      : (loadDraft(list) ?? newTeam(list)),
  );

  useEffect(() => {
    if (!demo) saveDraft(team);
  }, [demo, team]);

  return (
    <>
      <p className="list-name">
        <a href={`/l/${list.id}`}>{list.title}</a>
      </p>
      <Builder list={list} team={team} onChange={setTeam} />
      {list.disclaimer && list.id !== SEED_LISTS[0]!.id && (
        <p className="disclaimer">{list.disclaimer}</p>
      )}
    </>
  );
}
