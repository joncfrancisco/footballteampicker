import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  formationLabel,
  refLabel,
  rowsFor,
  slotsFor,
  type Formation,
  type Spot,
  type Team,
} from "@ftp/shared";
import { memo } from "react";
import { spotId, spotLabel } from "../dnd/ids";
import type { LoadedList } from "../lists";
import { Sprite } from "../Sprite";

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th"];
const COLUMNS = 6; // WR1–WR6 is the deepest row

type Props = { list: LoadedList; team: Team; offense: Formation; defense: Formation };

/** Classic depth chart: one row per position, starters first. Same team state as the field. */
export function DepthChart({ list, team, offense, defense }: Props) {
  return (
    <div className="depth-chart" data-testid="depth-chart">
      <SideTable
        side="offense"
        title="Offense"
        list={list}
        team={team}
        formation={offense}
        starters={new Set(slotsFor(offense, team.offense.qb).map((s) => refLabel(s.ref)))}
      />
      <SideTable
        side="defense"
        title={`Defense (${team.defense.front})`}
        list={list}
        team={team}
        formation={defense}
        starters={new Set(defense.slots.map((s) => refLabel(s.ref)))}
      />
    </div>
  );
}

function SideTable(props: {
  side: "offense" | "defense";
  title: string;
  list: LoadedList;
  team: Team;
  formation: Formation;
  starters: Set<string>;
}) {
  const { side, list, team, formation, starters } = props;
  const rows = side === "offense" ? rowsFor("offense") : rowsFor("defense", team.defense.front);
  const usedBy = formationLabel(formation);

  return (
    <table className="depth-side" data-testid={`depth-${side}`}>
      <caption>
        {props.title}
        <span className="depth-hint">Highlighted: starters in {usedBy}</span>
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
              const id = team[side].depth[pos]?.[index] ?? null;
              const starter = starters.has(spotLabel(spot));
              return (
                <td key={index}>
                  <Cell
                    spot={spot}
                    list={list}
                    charId={id}
                    starter={starter ? usedBy : undefined}
                  />
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const Cell = memo(function Cell(props: {
  spot: Spot;
  list: LoadedList;
  charId: string | null;
  /** Formation label if this spot is a starter in the current formation. */
  starter?: string;
}) {
  const { spot, list, charId, starter } = props;
  const id = spotId(spot);
  const label = spotLabel(spot);
  const character = charId ? list.byId.get(charId) : undefined;
  const drop = useDroppable({ id });
  const drag = useDraggable({ id, disabled: !character });

  return (
    <div
      ref={drop.setNodeRef}
      className={[
        "depth-cell",
        character && "filled",
        starter && "starter",
        drop.isOver && "over",
        drag.isDragging && "dragging",
      ]
        .filter(Boolean)
        .join(" ")}
      data-spot={label}
      title={starter ? `${label}: starter in ${starter}` : label}
    >
      {character ? (
        <button
          ref={drag.setNodeRef}
          type="button"
          className="depth-card"
          aria-label={`${character.name}, ${spot.side} ${label}`}
          {...drag.listeners}
          {...drag.attributes}
        >
          <Sprite list={list} index={character.atlasIndex} size={32} />
          <span className="depth-name">{character.name}</span>
        </button>
      ) : (
        <span className="depth-empty">{label}</span>
      )}
    </div>
  );
});
