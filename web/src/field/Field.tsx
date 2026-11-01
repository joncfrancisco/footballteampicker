import { refLabel, type Slot } from "@ftp/shared";
import { useMemo } from "react";
import { useSpot } from "../dnd/useSpot";
import { useLineup } from "../dnd/Lineup";
import { Sprite } from "../Sprite";
import { useWidth } from "../useSize";
import { layoutSlots } from "./layout";
import { arcPath, type Scale } from "./marks";
import type { Pane, SurfaceDef } from "./surfaces";
import { NARROW_WIDTH, TILE } from "./views";

type Props = { surface: SurfaceDef; pane: Pane };

/** One pane of a surface: its markings and the formation's slots. */
export function Field({ surface, pane }: Props) {
  const { slots, yMin, yMax, away, unit: side } = pane;
  const [ref, width] = useWidth<HTMLDivElement>();
  const narrow = width > 0 && width < NARROW_WIDTH;
  const tile = narrow ? TILE.narrow : TILE.wide;
  const height = surface.height(pane, width || NARROW_WIDTH, narrow);

  const placed = useMemo(
    () =>
      width === 0
        ? []
        : layoutSlots({
            slots,
            yMin,
            yMax,
            width,
            height,
            tile,
            away,
          }),
    [slots, yMin, yMax, width, height, tile, away],
  );
  const byId = new Map(slots.map((s) => [s.id, s]));

  return (
    <div
      ref={ref}
      className={`field field-${side} surface-${surface.id}${narrow ? " narrow" : ""}`}
      style={{ height, background: surface.background }}
      data-testid={`field-${side}`}
    >
      {width > 0 && (
        <Markings
          surface={surface}
          pane={pane}
          scale={{ sx: width / 100, sy: height / (yMax - yMin) }}
        />
      )}
      {placed.map((p) => (
        <SlotTile
          key={p.id}
          side={side}
          slot={byId.get(p.id)!}
          left={p.left}
          top={p.top}
          tile={tile}
          narrow={narrow}
        />
      ))}
    </div>
  );
}

function SlotTile(props: {
  side: string;
  slot: Slot;
  left: number;
  top: number;
  tile: { width: number; height: number; sprite: number };
  narrow: boolean;
}) {
  const { side, slot, left, top, tile, narrow } = props;
  const { list } = useLineup();
  // A slot can fill from another unit (baseball's pitcher stands on the defensive diamond).
  const spot = { side: slot.ref.unit ?? side, pos: slot.ref.pos, index: slot.ref.depth - 1 };
  const s = useSpot(spot);
  const ref = refLabel(slot.ref);
  return (
    <button
      ref={s.setNodeRef}
      {...s.buttonProps}
      className={[
        "slot",
        s.character && "filled",
        s.isOver && "over",
        s.isDragging && "dragging",
        s.isSelected && "selected",
        s.isTarget && "target",
      ]
        .filter(Boolean)
        .join(" ")}
      data-slot={slot.id}
      data-ref={ref}
      // Centred by offset, not transform: dnd-kit measures drop targets ignoring transforms.
      style={{
        left: left - tile.width / 2,
        top: top - tile.height / 2,
        width: tile.width,
        height: tile.height,
      }}
      title={`${slot.label} · ${ref}${s.character ? `: ${s.character.name}` : ""}`}
    >
      {s.character ? (
        <>
          <Sprite list={list} index={s.character.atlasIndex} size={tile.sprite} />
          {!narrow && <span className="slot-name">{s.character.name}</span>}
        </>
      ) : null}
      <span className="slot-label">{narrow ? ref : `${slot.label} · ${ref}`}</span>
      {s.character?.twoWay && <span className="badge two-way">2W</span>}
    </button>
  );
}

/** The surface's markings for the rows on show. */
function Markings({ surface, pane, scale }: { surface: SurfaceDef; pane: Pane; scale: Scale }) {
  const { yMin, yMax } = pane;
  return (
    <svg
      className="field-lines"
      viewBox={`0 ${yMin} 100 ${yMax - yMin}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {surface.marks(pane).map((m, i) => {
        const cls =
          m.kind === "line" && m.accent
            ? `mark accent${m.alt ? " alt" : ""}`
            : "fill" in m && m.fill
              ? "mark-fill"
              : "mark";
        const common = { key: i, className: cls, vectorEffect: "non-scaling-stroke" as const };
        if (m.kind === "line") return <line {...common} x1={m.x1} x2={m.x2} y1={m.y1} y2={m.y2} />;
        if (m.kind === "rect") return <rect {...common} x={m.x} y={m.y} width={m.w} height={m.h} />;
        if (m.kind === "circle")
          return (
            <ellipse {...common} cx={m.cx} cy={m.cy} rx={m.r} ry={(m.r * scale.sx) / scale.sy} />
          );
        if (m.kind === "arc") return <path {...common} d={arcPath(m, scale)} />;
        return <polygon {...common} points={m.points.map((p) => p.join(",")).join(" ")} />;
      })}
    </svg>
  );
}
