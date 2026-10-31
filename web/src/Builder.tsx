import {
  DEFAULT_DEFENSE,
  FRONTS,
  defenseFormations,
  emptyDepth,
  formationById,
  formationLabel,
  offenseFormations,
  rowsFor,
  slotsFor,
  type Formation,
  type Front,
  type Team,
} from "@ftp/shared";
import { useState } from "react";
import { Field } from "./field/Field";
import { VIEW } from "./field/views";
import type { LoadedList } from "./lists";
import { useMedia } from "./useSize";

const PACKAGES = { base: "Base", nickel: "Nickel", dime: "Dime" } as const;

type Props = { list: LoadedList; team: Team; onChange: (team: Team) => void };

export function Builder({ list, team, onChange }: Props) {
  const [tab, setTab] = useState<"offense" | "defense">("offense");
  const facing = useMedia("(min-width: 1100px)");

  const offense = formationById(team.offense.formation)!;
  const defense = formationById(team.defense.formation)!;
  const offenseSlots = slotsFor(offense, team.offense.qb);

  const setFront = (front: Front) => {
    if (front === team.defense.front) return;
    // #21 maps players across fronts; until then the defense starts over.
    onChange({
      ...team,
      defense: {
        front,
        depth: emptyDepth(rowsFor("defense", front)),
        formation: DEFAULT_DEFENSE[front],
      },
    });
  };

  const offenseField = (view: { yMin: number; yMax: number }) => (
    <Field side="offense" slots={offenseSlots} depth={team.offense.depth} list={list} {...view} />
  );
  const defenseField = (view: { yMin: number; yMax: number }) => (
    <Field side="defense" slots={defense.slots} depth={team.defense.depth} list={list} {...view} />
  );

  return (
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
        {(facing || tab === "defense") && (
          <FormationPicker
            label="Defense"
            value={defense.id}
            groups={groupBy(defenseFormations(team.defense.front), (f) => PACKAGES[f.package!])}
            onChange={(formation) => onChange({ ...team, defense: { ...team.defense, formation } })}
          />
        )}
        {(facing || tab === "offense") && (
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

      {facing ? (
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
