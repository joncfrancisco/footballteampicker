import {
  SPECIAL_TEAMS_ROWS,
  STAFF_ROLES,
  formationLabel,
  refLabel,
  rowsFor,
  slotsFor,
  type Formation,
  type Spot,
  type Team,
} from "@ftp/shared";
import { spotLabel } from "../dnd/ids";
import { useSpot } from "../dnd/useSpot";
import type { LoadedList } from "../lists";
import { Sprite } from "../Sprite";

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th"];
const COLUMNS = 6; // WR1–WR6 is the deepest row

type Props = { list: LoadedList; team: Team; offense: Formation; defense: Formation };

/**
 * Classic depth chart: one row per position, starters first. Same team state as the field.
 * Staff sit at the top and special teams at the bottom when the team has them (#22).
 */
export function DepthChart({ list, team, offense, defense }: Props) {
  const usedBy = (f: Formation) => formationLabel(f);
  return (
    <div className="depth-chart" data-testid="depth-chart">
      {team.staff && (
        <SideTable
          side="staff"
          title="Staff"
          list={list}
          rows={Object.fromEntries(STAFF_ROLES.map((r) => [r, 1]))}
          wide
        />
      )}
      <SideTable
        side="offense"
        title="Offense"
        list={list}
        rows={rowsFor("offense")}
        starters={{
          usedBy: usedBy(offense),
          spots: new Set(slotsFor(offense, team.offense.qb).map((s) => refLabel(s.ref))),
        }}
      />
      <SideTable
        side="defense"
        title={`Defense (${team.defense.front})`}
        list={list}
        rows={rowsFor("defense", team.defense.front)}
        starters={{
          usedBy: usedBy(defense),
          spots: new Set(defense.slots.map((s) => refLabel(s.ref))),
        }}
      />
      {team.specialTeams && (
        <SideTable
          side="specialTeams"
          title="Special teams"
          list={list}
          rows={SPECIAL_TEAMS_ROWS}
          wide
        />
      )}
    </div>
  );
}

function SideTable(props: {
  side: Spot["side"];
  title: string;
  list: LoadedList;
  rows: Readonly<Record<string, number>>;
  /** Spots the current formation uses, highlighted as starters. */
  starters?: { usedBy: string; spots: Set<string> };
  /** Span both columns of the desktop layout. */
  wide?: boolean;
}) {
  const { side, list, rows, starters } = props;
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
          {ORDINALS.map((o) => (
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
            {Array.from({ length: COLUMNS }, (_, index) => {
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
        </>
      ) : (
        <span className="depth-empty">{s.label}</span>
      )}
    </button>
  );
}
