import {
  FRONTS,
  at,
  autoFill,
  clearSide,
  defenseFormations,
  filledCount,
  formationById,
  formationLabel,
  movedNotice,
  offenseFormations,
  randomize,
  setSection,
  slotsFor,
  switchFront,
  type Formation,
  type Front,
  type Team,
} from "@ftp/shared";
import { useEffect, useState } from "react";
import { DepthChart } from "./depth/DepthChart";
import { spotLabel } from "./dnd/ids";
import { Lineup, useLineup } from "./dnd/Lineup";
import { ExportMenu } from "./export/ExportMenu";
import { Field } from "./field/Field";
import { VIEW } from "./field/views";
import type { LoadedList } from "./lists";
import { Pool } from "./pool/Pool";
import { SpecialTeamsPanel, StaffStrip } from "./sections/Sections";
import { useMedia } from "./useSize";

const PACKAGES = { base: "Base", nickel: "Nickel", dime: "Dime" } as const;

type Props = { list: LoadedList; team: Team; onChange: (team: Team) => void };

export function Builder({ list, team, onChange }: Props) {
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  return (
    <Lineup list={list} team={team} onChange={onChange} onNotice={setNotice}>
      <BuilderBody
        list={list}
        team={team}
        onChange={onChange}
        notice={notice}
        setNotice={setNotice}
      />
    </Lineup>
  );
}

function BuilderBody(props: Props & { notice: string; setNotice: (s: string) => void }) {
  const { list, team, onChange, notice, setNotice } = props;
  const [view, setView] = useState<"field" | "depth">("field");
  const [tab, setTab] = useState<"offense" | "defense">("offense");
  const facing = useMedia("(min-width: 1100px)");
  const bothPickers = facing || view === "depth";
  const order = list.characters.map((c) => c.id);

  const offense = formationById(team.offense.formation)!;
  const defense = formationById(team.defense.formation)!;
  const offenseSlots = slotsFor(offense, team.offense.qb);
  const qb = team.offense.qb ?? offense.qb;

  const toggleSection = (section: "specialTeams" | "staff") => {
    const on = team[section] !== undefined;
    const filled = filledCount(team, section);
    const name = section === "staff" ? "staff" : "special teams";
    if (
      on &&
      filled > 0 &&
      !window.confirm(
        `Remove ${name}? ${filled} filled ${filled === 1 ? "spot" : "spots"} will be cleared.`,
      )
    )
      return;
    onChange(setSection(team, section, !on));
  };

  const setFront = (front: Front) => {
    const { team: next, moved } = switchFront(team, front);
    onChange(next);
    setNotice(movedNotice(moved) ?? "");
  };

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
        <div className="view-toggle" role="group" aria-label="View">
          {(["field", "depth"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
              {v === "field" ? "Field" : "Depth chart"}
            </button>
          ))}
        </div>
        <div className="section-toggles" role="group" aria-label="Optional sections">
          {(["specialTeams", "staff"] as const).map((section) => (
            <button
              key={section}
              type="button"
              aria-pressed={team[section] !== undefined}
              onClick={() => toggleSection(section)}
            >
              {team[section] !== undefined ? "✓ " : "+ "}
              {section === "staff" ? "Staff" : "Special teams"}
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

      <div className="builder-layout">
        <div className="builder-main">
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
                      aria-pressed={qb === "gun"}
                      onClick={() =>
                        onChange({
                          ...team,
                          offense: { ...team.offense, qb: qb === "gun" ? "under" : "gun" },
                        })
                      }
                    >
                      {qb === "gun" ? "Shotgun" : "Under center"}
                    </button>
                  )
                }
              />
            )}
          </div>

          <div className="actions" role="group" aria-label="Lineup actions">
            <button type="button" onClick={() => onChange(autoFill(team, order))}>
              Auto-fill depth
            </button>
            <button type="button" onClick={() => onChange(randomize(team, order))}>
              Randomize
            </button>
            <button type="button" onClick={() => onChange(clearSide(team, "offense"))}>
              Clear offense
            </button>
            <button type="button" onClick={() => onChange(clearSide(team, "defense"))}>
              Clear defense
            </button>
          </div>

          <ExportMenu list={list} team={team} />

          <StatusBar notice={notice} />

          {view === "field" && team.staff && <StaffStrip />}

          {view === "depth" ? (
            <DepthChart list={list} team={team} offense={offense} defense={defense} />
          ) : facing ? (
            <div className="facing">
              <Field side="defense" slots={defense.slots} {...VIEW.faceDefense} />
              <Field side="offense" slots={offenseSlots} {...VIEW.faceOffense} />
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
              {tab === "offense" ? (
                <Field side="offense" slots={offenseSlots} {...VIEW.offense} />
              ) : (
                <Field side="defense" slots={defense.slots} {...VIEW.defense} />
              )}
            </>
          )}

          {view === "field" && team.specialTeams && <SpecialTeamsPanel />}
        </div>
        <Pool />
      </div>
    </section>
  );
}

/** Notices ("Ahri isn't a two-way player") and the tap-to-place prompt. */
function StatusBar({ notice }: { notice: string }) {
  const { list, team, selected, removeSelected, clearSelection } = useLineup();
  let prompt: React.ReactNode = null;
  if (selected) {
    const id = selected.kind === "pool" ? selected.id : at(team, selected.spot);
    const name = (id && list.byId.get(id)?.name) ?? "";
    prompt = (
      <>
        <span>
          {selected.kind === "pool"
            ? `${name} selected: tap a spot to place them.`
            : `${name} (${spotLabel(selected.spot)}) selected: tap a spot to move them.`}
        </span>
        {selected.kind === "spot" && (
          <button type="button" onClick={removeSelected}>
            Remove
          </button>
        )}
        <button type="button" onClick={clearSelection}>
          Cancel
        </button>
      </>
    );
  }
  return (
    <div className="status-bar">
      <p className="notice" role="status" aria-live="polite">
        {notice}
      </p>
      {prompt && <div className="selection">{prompt}</div>}
    </div>
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
