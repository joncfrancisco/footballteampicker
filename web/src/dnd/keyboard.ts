import type { KeyboardCoordinateGetter } from "@dnd-kit/core";
import { POOL_DROP } from "./ids";

const DIRECTIONS: Record<string, [number, number]> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowUp: [0, -1],
};

/**
 * Arrow keys jump straight to the nearest spot in that direction (rather than dnd-kit's
 * default 25px nudge), favouring spots in line with the current one.
 */
export const jumpToNearestSpot: KeyboardCoordinateGetter = (event, { context }) => {
  const dir = DIRECTIONS[event.code];
  const from = context.collisionRect;
  if (!dir || !from) return undefined;
  event.preventDefault();

  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let best: { left: number; top: number; width: number; height: number } | undefined;
  let bestScore = Infinity;
  for (const container of context.droppableContainers.getEnabled()) {
    if (container.id === POOL_DROP) continue;
    const r = context.droppableRects.get(container.id);
    if (!r) continue;
    const dx = r.left + r.width / 2 - cx;
    const dy = r.top + r.height / 2 - cy;
    const along = dx * dir[0] + dy * dir[1];
    if (along <= 1) continue;
    const across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
    const score = along + across * 3;
    if (score < bestScore) {
      bestScore = score;
      best = r;
    }
  }
  if (!best) return undefined;
  return {
    x: best.left + (best.width - from.width) / 2,
    y: best.top + (best.height - from.height) / 2,
  };
};
