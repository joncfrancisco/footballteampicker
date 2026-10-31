import { newTeam, type Team } from "@ftp/shared";
import { useEffect, useState } from "react";
import { Builder } from "./Builder";
import { demoTeam } from "./demo";
import { loadDraft, saveDraft } from "./draft";
import { SEED_LISTS } from "./lists";

const list = SEED_LISTS[0]!;
// ?fill=demo (&sections=1) is for screenshots and checks; it never touches the saved draft.
const params = () => new URLSearchParams(window.location.search);
const isDemo = () => params().get("fill") === "demo";

export function App() {
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
