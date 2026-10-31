import { newTeam, type Team } from "@ftp/shared";
import { useEffect, useState } from "react";
import { Builder } from "./Builder";
import { fillDemo } from "./demo";
import { loadDraft, saveDraft } from "./draft";
import { SEED_LISTS } from "./lists";

const list = SEED_LISTS[0]!;
// ?fill=demo is for screenshots and checks; it never touches the saved draft.
const isDemo = () => new URLSearchParams(window.location.search).get("fill") === "demo";

export function App() {
  const [demo] = useState(isDemo);
  const [team, setTeam] = useState<Team>(() =>
    demo ? fillDemo(newTeam(list), list) : (loadDraft(list) ?? newTeam(list)),
  );

  useEffect(() => {
    if (!demo) saveDraft(team);
  }, [demo, team]);

  return (
    <>
      <header className="site-header">
        <h1>Depth Chart</h1>
        <p className="list-name">{list.title}</p>
      </header>
      <main>
        <Builder list={list} team={team} onChange={setTeam} />
      </main>
      {list.disclaimer && <footer className="disclaimer">{list.disclaimer}</footer>}
    </>
  );
}
