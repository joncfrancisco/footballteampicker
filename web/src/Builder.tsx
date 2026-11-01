import {
  at,
  autoFill,
  clearSide,
  filledCount,
  findFormation,
  formationLabel,
  movedNotice,
  randomize,
  setSection,
  sportOf,
  switchVariant,
  unitFormations,
  type Formation,
  type Team,
} from "@ftp/shared";
import { useEffect, useState } from "react";
import { DepthChart } from "./depth/DepthChart";
import { spotLabel } from "./dnd/ids";
import { Lineup, useLineup } from "./dnd/Lineup";
import { ExportMenu } from "./export/ExportMenu";
import { Field } from "./field/Field";
import { surfaceOf } from "./field/surfaces";
import type { LoadedList } from "./lists";
import { Pool } from "./pool/Pool";
import { SectionPanel, StaffStrip } from "./sections/Sections";
import { useMedia } from "./useSize";

type Props = {
  list: LoadedList;
  team: Team;
  onChange: (team: Team) => void;
  readOnly?: boolean;
  initialView?: "field" | "depth";
  children?: React.ReactNode;
};

export function Builder({ list, team, onChange, readOnly = false, initialView, children }: Props) {
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  return (
    <Lineup list={list} team={team} onChange={onChange} onNotice={setNotice} readOnly={readOnly}>
      <BuilderBody
        list={list}
        team={team}
        onChange={onChange}
        notice={notice}
        setNotice={setNotice}
        readOnly={readOnly}
        initialView={initialView}
        children={children}
      />
    </Lineup>
  );
}

function BuilderBody(props: Props & { notice: string; setNotice: (s: string) => void }) {
  const { list, team, onChange, notice, setNotice, readOnly, children } = props;
  const [view, setView] = useState<"field" | "depth">(props.initialView ?? "field");
  const sport = sportOf(team);
  const surface = surfaceOf(sport);
  const wide = useMedia("(min-width: 1100px)");
  const facingPanes = wide ? surface.facing?.(sport, team) : undefined;
  const panes = surface.panes(sport, team);
  const [tabState, setTab] = useState(panes[0]?.unit);
  const tab = panes.some((p) => p.unit === tabState) ? tabState : panes[0]?.unit;
  const bothPickers = !!facingPanes || view === "depth" || panes.length < 2;
  const order = list.characters.map((c) => c.id);

  const formationOf = (unit: string) => findFormation(sport, team.units[unit]?.formation);
  // Pickers follow the surface: on the gridiron the defense is drawn above the offense.
  const pickerUnits = sport.surface === "gridiron" ? [...sport.units].reverse() : sport.units;

  const toggleSection = (section: string) => {
    const on = team.sections?.[section] !== undefined;
    const filled = filledCount(team, section);
    const name = sport.sections.find((s) => s.id === section)!.name.toLowerCase();
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

  const staff = sport.sections.find((s) => s.kind === "staff" && team.sections?.[s.id]);
  const situational = sport.sections.filter(
    (s) => s.kind === "situational" && team.sections?.[s.id],
  );

  const setVariant = (unit: string, variant: string) => {
    const { team: next, moved } = switchVariant(team, unit, variant);
    onChange(next);
    setNotice(movedNotice(moved) ?? "");
  };

  const setUnit = (unit: string, patch: Partial<Team["units"][string]>) =>
    onChange({ ...team, units: { ...team.units, [unit]: { ...team.units[unit]!, ...patch } } });

  return (
    <section className="builder">
      <div className="team-meta">
        {readOnly ? (
          <h2 className="team-title">{team.title}</h2>
        ) : (
          <label className="team-title">
            <span className="visually-hidden">Team name</span>
            <input
              value={team.title}
              maxLength={80}
              onChange={(e) => onChange({ ...team, title: e.target.value })}
            />
          </label>
        )}
        <div className="view-toggle" role="group" aria-label="View">
          {(["field", "depth"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
              {v === "field" ? surface.noun : "Depth chart"}
            </button>
          ))}
        </div>
        {!readOnly && (
          <>
            <div className="section-toggles" role="group" aria-label="Optional sections">
              {sport.sections.map((section) => {
                const on = team.sections?.[section.id] !== undefined;
                return (
                  <button
                    key={section.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleSection(section.id)}
                  >
                    {on ? "✓ " : "+ "}
                    {section.name}
                  </button>
                );
              })}
            </div>
            {sport.units
              .filter((u) => u.variants.length > 1)
              .map((unit) => (
                <label key={unit.id}>
                  {unit.variantLabel ?? unit.name}{" "}
                  <select
                    value={team.units[unit.id]!.variant}
                    onChange={(e) => setVariant(unit.id, e.target.value)}
                  >
                    {unit.variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
          </>
        )}
      </div>

      <div className="builder-layout">
        <div className="builder-main">
          <div className="pickers">
            {pickerUnits.map((unit) => {
              const state = team.units[unit.id]!;
              const f = formationOf(unit.id);
              const options = unitFormations(sport, unit.id, state.variant);
              if (!f || !options.length || !(bothPickers || tab === unit.id)) return null;
              const align = state.align ?? f.qb;
              return (
                <FormationPicker
                  key={unit.id}
                  label={unit.name}
                  value={f.id}
                  groups={groupBy(options, (o) => o.group ?? "")}
                  onChange={(formation) => setUnit(unit.id, { formation, align: undefined })}
                  extra={
                    f.altQb && (
                      <button
                        type="button"
                        className="qb-toggle"
                        aria-pressed={align === "gun"}
                        onClick={() =>
                          setUnit(unit.id, { align: align === "gun" ? "under" : "gun" })
                        }
                      >
                        {align === "gun" ? "Shotgun" : "Under center"}
                      </button>
                    )
                  }
                />
              );
            })}
          </div>

          {!readOnly && (
            <div className="actions" role="group" aria-label="Lineup actions">
              <button type="button" onClick={() => onChange(autoFill(team, order))}>
                Auto-fill depth
              </button>
              <button type="button" onClick={() => onChange(randomize(team, order))}>
                Randomize
              </button>
              {sport.units.map((unit) => (
                <button
                  key={unit.id}
                  type="button"
                  onClick={() => onChange(clearSide(team, unit.id))}
                >
                  Clear {unit.name.toLowerCase()}
                </button>
              ))}
            </div>
          )}

          <ExportMenu list={list} team={team} />
          {children}

          <StatusBar notice={notice} />

          {view === "field" && staff && <StaffStrip section={staff} />}

          {view === "depth" ? (
            <DepthChart list={list} team={team} sport={sport} />
          ) : facingPanes ? (
            <div className="facing">
              {facingPanes.map((pane) => (
                <Field key={pane.unit} surface={surface} pane={pane} />
              ))}
            </div>
          ) : (
            <>
              {panes.length > 1 && (
                <div className="tabs" role="tablist">
                  {panes.map((pane) => (
                    <button
                      key={pane.unit}
                      role="tab"
                      aria-selected={tab === pane.unit}
                      onClick={() => setTab(pane.unit)}
                    >
                      {pane.label}
                    </button>
                  ))}
                </div>
              )}
              {panes
                .filter((pane) => pane.unit === tab)
                .map((pane) => (
                  <Field key={pane.unit} surface={surface} pane={pane} />
                ))}
            </>
          )}

          {view === "field" &&
            situational.map((section) => <SectionPanel key={section.id} section={section} />)}
        </div>
        {!readOnly && <Pool />}
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
