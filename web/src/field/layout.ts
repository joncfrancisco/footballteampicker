/**
 * Places slot tiles on a field of `width` × `height` px. Formation coordinates are exact on
 * a wide screen, but on a phone the five linemen sit inside ~90 px, so tiles that would
 * overlap are first pushed apart sideways (keeping left-to-right order). If a row still
 * doesn't fit, the outermost player of a clashing pair steps back a row, away from the line
 * of scrimmage, the way a receiver goes from on the line to off it.
 */
export type Placed = { id: string; left: number; top: number };

export type LayoutInput = {
  slots: { id: string; x: number; y: number }[];
  yMin: number;
  yMax: number;
  width: number;
  height: number;
  tile: { width: number; height: number };
  /** Which way is away from the line of scrimmage: +1 down (offense), -1 up (defense). */
  away: 1 | -1;
  gap?: number;
};

type Item = Placed & { x: number };

export function layoutSlots(input: LayoutInput): Placed[] {
  const { slots, yMin, yMax, width, height, tile, away, gap = 2 } = input;
  const clampX = (v: number) => Math.min(width - tile.width / 2, Math.max(tile.width / 2, v));
  const clampY = (v: number) => Math.min(height - tile.height / 2, Math.max(tile.height / 2, v));
  const needX = tile.width + gap;
  const needY = tile.height + gap;
  const clash = (a: Item, b: Item) =>
    Math.abs(a.top - b.top) < needY - 0.01 && Math.abs(a.left - b.left) < needX - 0.01;

  const items: Item[] = slots
    .map((s) => ({
      id: s.id,
      x: s.x,
      left: clampX((s.x / 100) * width),
      top: clampY(((s.y - yMin) / (yMax - yMin)) * height),
    }))
    // Order is decided once, from the formation, so pushing never swaps neighbours.
    .sort((a, b) => a.left - b.left || a.id.localeCompare(b.id));

  const spreadSideways = () => {
    for (let iter = 0; iter < 200; iter++) {
      let moved = false;
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i]!;
          const b = items[j]!;
          if (Math.abs(a.top - b.top) >= needY - 0.01) continue;
          const overlap = needX - (b.left - a.left);
          if (overlap > 0.01) {
            a.left = clampX(a.left - overlap / 2);
            b.left = clampX(b.left + overlap / 2);
            moved = true;
          }
        }
      }
      if (!moved) return;
    }
  };

  for (let round = 0; round < items.length; round++) {
    spreadSideways();
    const pair = items.flatMap((a, i) =>
      items
        .slice(i + 1)
        .filter((b) => clash(a, b))
        .map((b) => [a, b] as const),
    )[0];
    if (!pair) break;
    const [a, b] = pair;
    // The player further from the middle of the field steps back.
    const outer = Math.abs(a.x - 50) >= Math.abs(b.x - 50) ? a : b;
    const other = outer === a ? b : a;
    outer.top = clampY(other.top + away * needY);
  }
  return items.map(({ id, left, top }) => ({ id, left, top }));
}
