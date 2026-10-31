import { LOS_Y, atRef, refLabel, type Depth, type Slot } from "@ftp/shared";
import { useMemo } from "react";
import type { LoadedList } from "../lists";
import { Sprite } from "../Sprite";
import { useWidth } from "../useSize";
import { layoutSlots } from "./layout";
import { NARROW_WIDTH, SCALE, TILE } from "./views";

type Props = {
  side: "offense" | "defense";
  slots: Slot[];
  depth: Depth;
  list: LoadedList;
  /** Field rows to show (0–100 field units). */
  yMin: number;
  yMax: number;
};

/** One side of the ball: turf, lines and the formation's 11 slots. */
export function Field({ side, slots, depth, list, yMin, yMax }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const narrow = width > 0 && width < NARROW_WIDTH;
  const tile = narrow ? TILE.narrow : TILE.wide;
  const height = Math.round((yMax - yMin) * (narrow ? SCALE.narrow : SCALE.wide));

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
            away: side === "offense" ? 1 : -1,
          }),
    [slots, yMin, yMax, width, height, tile, side],
  );
  const byId = new Map(slots.map((s) => [s.id, s]));

  return (
    <div
      ref={ref}
      className={`field field-${side}${narrow ? " narrow" : ""}`}
      style={{ height }}
      data-testid={`field-${side}`}
    >
      <FieldLines yMin={yMin} yMax={yMax} />
      {placed.map((p) => {
        const slot = byId.get(p.id)!;
        const charId = atRef(depth, slot.ref);
        const character = charId ? list.byId.get(charId) : undefined;
        return (
          <div
            key={slot.id}
            className={`slot${character ? " filled" : ""}`}
            data-slot={slot.id}
            data-ref={refLabel(slot.ref)}
            style={{ left: p.left, top: p.top, width: tile.width, height: tile.height }}
            title={`${slot.label} · ${refLabel(slot.ref)}${character ? `: ${character.name}` : ""}`}
          >
            {character ? (
              <>
                <Sprite list={list} index={character.atlasIndex} size={tile.sprite} />
                {!narrow && <span className="slot-name">{character.name}</span>}
              </>
            ) : null}
            <span className="slot-label">
              {narrow ? refLabel(slot.ref) : `${slot.label} · ${refLabel(slot.ref)}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Yard lines every 5 yards (10 units) from the line of scrimmage, hash marks every yard. */
function FieldLines({ yMin, yMax }: { yMin: number; yMax: number }) {
  const lines: number[] = [];
  for (let y = LOS_Y - 50; y <= LOS_Y + 50; y += 10) if (y > yMin && y < yMax) lines.push(y);
  const hashes: number[] = [];
  for (let y = Math.ceil(yMin / 2) * 2; y < yMax; y += 2) hashes.push(y);
  const showLos = LOS_Y >= yMin && LOS_Y <= yMax;

  return (
    <svg
      className="field-lines"
      viewBox={`0 ${yMin} 100 ${yMax - yMin}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {lines.map((y) => (
        <line
          key={y}
          x1={0}
          x2={100}
          y1={y}
          y2={y}
          className="yard"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {hashes.map((y) =>
        [0.5, 44.3, 55.7, 99.5].map((x) => (
          <line
            key={`${x}-${y}`}
            x1={x - 0.6}
            x2={x + 0.6}
            y1={y}
            y2={y}
            className="hash"
            vectorEffect="non-scaling-stroke"
          />
        )),
      )}
      {showLos && (
        <line
          x1={0}
          x2={100}
          y1={LOS_Y}
          y2={LOS_Y}
          className="los"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
