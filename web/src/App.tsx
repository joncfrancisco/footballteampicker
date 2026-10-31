import { newTeam, type Team } from "@ftp/shared";
import { useState } from "react";
import { Builder } from "./Builder";
import { fillDemo } from "./demo";
import { SEED_LISTS } from "./lists";

const list = SEED_LISTS[0]!;

function initialTeam(): Team {
  const team = newTeam(list);
  return new URLSearchParams(window.location.search).get("fill") === "demo"
    ? fillDemo(team, list)
    : team;
}

export function App() {
  const [team, setTeam] = useState(initialTeam);

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
