import {
  FRONTS,
  defenseFormations,
  formationById,
  formationLabel,
  movedNotice,
  offenseFormations,
  slotsFor,
  switchFront,
  type Formation,
  type Front,
  type Team,
} from "@ftp/shared";
import { useEffect, useState } from "react";
import { DepthChart } from "./depth/DepthChart";
import { LineupDnd } from "./dnd/LineupDnd";
import { Field } from "./field/Field";
import { VIEW } from "./field/views";
import type { LoadedList } from "./lists";
import { useMedia } from "./useSize";

const PACKAGES = { base: "Base", nickel: "Nickel", dime: "Dime" } as const;

type Props = { list: LoadedList; team: Team; onChange: (team: Team) => void };

export function Builder({ list, team, onChange }: Props) {
  const [view, setView] = useState<"field" | "depth">("field");
  const [tab, setTab] = useState<"offense" | "defense">("offense");
  const [notice, setNotice] = useState("");
  const facing = useMedia("(min-width: 1100px)");
  const bothPickers = facing || view === "depth";

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const offense = formationById(team.offense.formation)!;
  const defense = formationById(team.defense.formation)!;
  const offenseSlots = slotsFor(offense, team.offense.qb);

  const setFront = (front: Front) => {
    const { team: next, moved } = switchFront(team, front);
    onChange(next);
    setNotice(movedNotice(moved) ?? "");
  };

  const offenseField = (view: { yMin: number; yMax: number }) => (
    <Field side="offense" slots={offenseSlots} depth={team.offense.depth} list={list} {...view} />
  );
  const defenseField = (view: { yMin: number; yMax: number }) => (
    <Field side="defense" slots={defense.slots} depth={team.defense.depth} list={list} {...view} />
  );

  return (
    <LineupDnd list={list} team={team} onChange={onChange} onNotice={setNotice}>
      <section className="builder">
        <div className="team-meta">
          <label className="team-title">
            <span className="visually-hidden">Team name</span>
            <input
              value={team.title}
              maxLength={80}
              onChange={(e) => onChange({ ...team, title: e.target.value })}
            />
          </label>
          <div className="view-toggle" role="group" aria-label="View">
            {(["field", "depth"] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
                {v === "field" ? "Field" : "Depth chart"}
              </button>
            ))}
          </div>
          <label>
            Front{" "}
            <select value={team.defense.front} onChange={(e) => setFront(e.target.value as Front)}>
              {FRONTS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="pickers">
          {(bothPickers || tab === "defense") && (
            <FormationPicker
              label="Defense"
              value={defense.id}
              groups={groupBy(defenseFormations(team.defense.front), (f) => PACKAGES[f.package!])}
              onChange={(formation) =>
                onChange({ ...team, defense: { ...team.defense, formation } })
              }
            />
          )}
          {(bothPickers || tab === "offense") && (
            <FormationPicker
              label="Offense"
              value={offense.id}
              groups={groupBy(offenseFormations(), (f) => `${f.personnel} personnel`)}
              onChange={(formation) =>
                onChange({ ...team, offense: { ...team.offense, formation, qb: undefined } })
              }
              extra={
                offense.altQb && (
                  <button
                    type="button"
                    className="qb-toggle"
                    aria-pressed={(team.offense.qb ?? offense.qb) === "gun"}
                    onClick={() =>
                      onChange({
                        ...team,
                        offense: {
                          ...team.offense,
                          qb: (team.offense.qb ?? offense.qb) === "gun" ? "under" : "gun",
                        },
                      })
                    }
                  >
                    {(team.offense.qb ?? offense.qb) === "gun" ? "Shotgun" : "Under center"}
                  </button>
                )
              }
            />
          )}
        </div>

        <p className="notice" role="status" aria-live="polite">
          {notice}
        </p>

        {view === "depth" ? (
          <DepthChart list={list} team={team} offense={offense} defense={defense} />
        ) : facing ? (
          <div className="facing">
            {defenseField(VIEW.faceDefense)}
            {offenseField(VIEW.faceOffense)}
          </div>
        ) : (
          <>
            <div className="tabs" role="tablist">
              {(["offense", "defense"] as const).map((side) => (
                <button
                  key={side}
                  role="tab"
                  aria-selected={tab === side}
                  onClick={() => setTab(side)}
                >
                  {side === "offense" ? "Offense" : "Defense"}
                </button>
              ))}
            </div>
            {tab === "offense" ? offenseField(VIEW.offense) : defenseField(VIEW.defense)}
          </>
        )}
      </section>
    </LineupDnd>
  );
}

function FormationPicker(props: {
  label: string;
  value: string;
  groups: [string, Formation[]][];
  onChange: (id: string) => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="picker">
      <label>
        {props.label}{" "}
        <select value={props.value} onChange={(e) => props.onChange(e.target.value)}>
          {props.groups.map(([group, formations]) => (
            <optgroup key={group} label={group}>
              {formations.map((f) => (
                <option key={f.id} value={f.id}>
                  {formationLabel(f)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {props.extra}
    </div>
  );
}

function groupBy<T>(items: T[], key: (item: T) => string): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return [...groups];
}
