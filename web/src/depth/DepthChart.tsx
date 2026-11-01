import {
  findFormation,
  formationLabel,
  refLabel,
  slotsFor,
  unitRows,
  type Rows,
  type Spot,
  type SportDef,
  type Team,
} from "@ftp/shared";
import { spotLabel } from "../dnd/ids";
import { useSpot } from "../dnd/useSpot";
import type { LoadedList } from "../lists";
import { Sprite } from "../Sprite";

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th"];

type Props = { list: LoadedList; team: Team; sport: SportDef };

/** How deep the deepest row of the sport goes (WR1–WR6 in football). */
export function depthColumns(sport: SportDef): number {
  const rows = [
    ...sport.units.flatMap((u) => u.variants.map((v) => v.rows)),
    ...sport.sections.map((s) => s.rows),
  ];
  return Math.max(1, ...rows.flatMap((r) => Object.values(r)));
}

/**
 * Classic depth chart: one row per position, starters first. Same team state as the field.
 * Staff sit at the top and situational sections at the bottom when the team has them (#22).
 */
export function DepthChart({ list, team, sport }: Props) {
  const columns = depthColumns(sport);
  const staff = sport.sections.find((s) => s.kind === "staff" && team.sections?.[s.id]);
  return (
    <div className="depth-chart" data-testid="depth-chart">
      {staff && (
        <SideTable
          side={staff.id}
          title={staff.name}
          list={list}
          rows={staff.rows}
          columns={columns}
          wide
        />
      )}
      {sport.units.map((unit) => {
        const state = team.units[unit.id]!;
        const f = findFormation(sport, state.formation);
        const variant =
          unit.variants.length > 1 && unit.variants.find((v) => v.id === state.variant);
        return (
          <SideTable
            key={unit.id}
            side={unit.id}
            title={variant ? `${unit.name} (${variant.name})` : unit.name}
            list={list}
            rows={unitRows(unit, state.variant)}
            columns={columns}
            starters={
              f && {
                usedBy: formationLabel(f),
                spots: new Set(
                  slotsFor(f, state.align)
                    .filter((s) => !s.ref.unit || s.ref.unit === unit.id)
                    .map((s) => refLabel(s.ref)),
                ),
              }
            }
          />
        );
      })}
      {sport.sections
        .filter((s) => s.kind === "situational" && team.sections?.[s.id])
        .map((s) => (
          <SideTable
            key={s.id}
            side={s.id}
            title={s.name}
            list={list}
            rows={s.rows}
            columns={columns}
            wide
          />
        ))}
    </div>
  );
}

function SideTable(props: {
  side: Spot["side"];
  title: string;
  list: LoadedList;
  rows: Rows;
  columns: number;
  /** Spots the current formation uses, highlighted as starters. */
  starters?: { usedBy: string; spots: Set<string> };
  /** Span both columns of the desktop layout. */
  wide?: boolean;
}) {
  const { side, list, rows, starters, columns } = props;
  return (
    <table className={`depth-side${props.wide ? " wide" : ""}`} data-testid={`depth-${side}`}>
      <caption>
        {props.title}
        {starters && <span className="depth-hint">Highlighted: starters in {starters.usedBy}</span>}
      </caption>
      <thead>
        <tr>
          <th scope="col">
            <span className="visually-hidden">Position</span>
          </th>
          {ORDINALS.slice(0, columns).map((o) => (
            <th key={o} scope="col">
              {o}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Object.entries(rows).map(([pos, n]) => (
          <tr key={pos}>
            <th scope="row">{pos}</th>
            {Array.from({ length: columns }, (_, index) => {
              if (index >= n) return <td key={index} className="depth-none" />;
              const spot = { side, pos, index };
              const starter = starters?.spots.has(spotLabel(spot));
              return (
                <td key={index}>
                  <Cell spot={spot} list={list} starter={starter ? starters!.usedBy : undefined} />
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Cell(props: {
  spot: Spot;
  list: LoadedList;
  /** Formation label if this spot is a starter in the current formation. */
  starter?: string;
}) {
  const { spot, list, starter } = props;
  const s = useSpot(spot);
  return (
    <button
      ref={s.setNodeRef}
      {...s.buttonProps}
      className={[
        "depth-cell",
        s.character && "filled",
        starter && "starter",
        s.isOver && "over",
        s.isDragging && "dragging",
        s.isSelected && "selected",
        s.isTarget && "target",
      ]
        .filter(Boolean)
        .join(" ")}
      data-spot={s.label}
      title={starter ? `${s.label}: starter in ${starter}` : s.label}
    >
      {s.character ? (
        <>
          <Sprite list={list} index={s.character.atlasIndex} size={32} />
          <span className="depth-name">{s.character.name}</span>
          {s.character.twoWay && <span className="two-way-text">2W</span>}
        </>
      ) : (
        <span className="depth-empty">{s.label}</span>
      )}
    </button>
  );
}
