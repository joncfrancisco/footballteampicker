import { formationById, type Team, type PublishedTeam } from "@ftp/shared";
import { useCallback, useState } from "react";
import { Builder } from "./Builder";
import { NotFound } from "./Catalog";
import { loadList, type LoadedList } from "./lists";
import { ShareLink } from "./ShareMenu";
import { loadTeam, remixTeam, snapshotList } from "./sharing";
import { useResource } from "./useResource";

export function TeamPage({ id }: { id: string }) {
  const load = useCallback((signal: AbortSignal) => loadTeam(id, signal), [id]);
  const { value, error, retry } = useResource(load);
  if (error?.message === "missing") return <NotFound />;
  if (error)
    return (
      <p role="alert">
        Could not load this team. <button onClick={retry}>Retry</button>
      </p>
    );
  if (!value) return <p role="status">Loading team…</p>;
  return <TeamViewer saved={value} />;
}

function TeamViewer({ saved }: { saved: PublishedTeam }) {
  const [list] = useState(() => snapshotList(saved));
  const [team, setTeam] = useState<Team>(() => {
    const t = structuredClone(saved) as Team;
    const params = new URLSearchParams(location.search);
    const o = formationById(params.get("o") ?? "");
    const d = formationById(params.get("d") ?? "");
    if (o?.side === "offense") t.offense = { ...t.offense, formation: o.id, qb: undefined };
    if (d?.side === "defense" && d.front === t.defense.front)
      t.defense = { ...t.defense, formation: d.id };
    return t;
  });
  return (
    <>
      <p>
        Built from <a href={`/l/${saved.listId}`}>{saved.listTitle}</a>
      </p>
      <div className="actions">
        <a className="button-link" href={`/build/${saved.listId}?remix=${saved.id}`}>
          Remix this team
        </a>
        <a href={`/report?type=team&id=${saved.id}`}>Report</a>
      </div>
      <ShareLink url={location.href} />
      <Builder
        list={list}
        team={team}
        onChange={setTeam}
        readOnly
        initialView={
          new URLSearchParams(location.search).get("view") === "depth" ? "depth" : "field"
        }
      />
      {saved.disclaimer && <p className="card-disclaimer">{saved.disclaimer}</p>}
    </>
  );
}

export function RemixBuilder({
  id,
  listId,
  render,
}: {
  id: string;
  listId: string;
  render: (list: LoadedList, team: Team, notices: string[]) => React.ReactNode;
}) {
  const load = useCallback(
    async (signal: AbortSignal) => {
      const [saved, list] = await Promise.all([loadTeam(id, signal), loadList(listId, signal)]);
      if (saved.listId !== list.id) throw new Error("The team belongs to another list.");
      return { list, ...remixTeam(saved, list) };
    },
    [id, listId],
  );
  const { value, error, retry } = useResource(load);
  if (error)
    return (
      <p role="alert">
        Could not remix this team. Its source list may have been removed.{" "}
        <button onClick={retry}>Retry</button>
      </p>
    );
  if (!value) return <p role="status">Loading the current list for your remix…</p>;
  return render(value.list, value.team, value.notices);
}
