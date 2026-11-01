import { moveInOrder, orderSpots, type Team, type UnitDef } from "@ftp/shared";
import { useLineup } from "../dnd/Lineup";
import { useSpot } from "../dnd/useSpot";
import { Sprite } from "../Sprite";

/**
 * The batting order (#65): an ordering of the starters, not separate spots. Each row is the
 * starter's spot (drop or tap to fill it) with buttons to move it up or down the order.
 */
export function BattingOrder({
  unit,
  onChange,
}: {
  unit: UnitDef;
  onChange: (team: Team) => void;
}) {
  const { team, readOnly } = useLineup();
  const state = team.units[unit.id]!;
  const spots = orderSpots(unit, state.variant, state.order);
  return (
    <section
      className="section-strip batting-order"
      aria-label="Batting order"
      data-testid="batting-order"
    >
      <h2>Batting order</h2>
      <ol>
        {spots.map((o, i) => (
          <li key={o.id} data-order={o.id}>
            <span className="order-number">{i + 1}</span>
            <OrderTile
              spot={{ side: o.ref.unit ?? unit.id, pos: o.ref.pos, index: o.ref.depth - 1 }}
              label={o.id === "P" ? "P (SP1)" : o.label}
            />
            {!readOnly && (
              <span className="order-moves">
                <button
                  type="button"
                  aria-label={`Move ${o.label} up the order`}
                  disabled={i === 0}
                  onClick={() => onChange(moveInOrder(team, unit.id, o.id, -1))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${o.label} down the order`}
                  disabled={i === spots.length - 1}
                  onClick={() => onChange(moveInOrder(team, unit.id, o.id, 1))}
                >
                  ↓
                </button>
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function OrderTile({ spot, label }: { spot: Parameters<typeof useSpot>[0]; label: string }) {
  const { list } = useLineup();
  const s = useSpot(spot);
  return (
    <button
      ref={s.setNodeRef}
      {...s.buttonProps}
      className={[
        "section-tile",
        s.character && "filled",
        s.isOver && "over",
        s.isDragging && "dragging",
        s.isSelected && "selected",
        s.isTarget && "target",
      ]
        .filter(Boolean)
        .join(" ")}
      data-spot={s.label}
    >
      {s.character ? (
        <Sprite list={list} index={s.character.atlasIndex} size={32} />
      ) : (
        <span className="section-empty" aria-hidden="true" />
      )}
      <span className="section-text">
        <span className="section-name">
          {s.character?.name ?? "Open"}
          {s.character?.twoWay && <span className="two-way-text"> 2W</span>}
        </span>
        <span className="section-label">{label}</span>
      </span>
    </button>
  );
}
