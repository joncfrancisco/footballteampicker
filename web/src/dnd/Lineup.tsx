import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  move,
  place,
  remove,
  usage,
  type CharId,
  type Result,
  type Spot,
  type Team,
} from "@ftp/shared";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { LoadedList } from "../lists";
import { Sprite } from "../Sprite";
import { POOL_DROP, parsePoolId, parseSpotId, spotLabel } from "./ids";
import { jumpToNearestSpot } from "./keyboard";

export type Selection = { kind: "pool"; id: CharId } | { kind: "spot"; spot: Spot } | null;

type LineupValue = {
  list: LoadedList;
  team: Team;
  /** Sides each character plays. */
  sides: Map<CharId, Set<Spot["side"]>>;
  selected: Selection;
  /** Tap a pool card: select it (or unselect it). */
  selectPool: (id: CharId) => void;
  /** Tap a spot: place or move the selection there, or select whoever is in it. */
  activateSpot: (spot: Spot) => void;
  removeSelected: () => void;
  clearSelection: () => void;
};

const LineupContext = createContext<LineupValue | null>(null);

export function useLineup(): LineupValue {
  const value = useContext(LineupContext);
  if (!value) throw new Error("useLineup outside <Lineup>");
  return value;
}

export function sameSpot(a: Spot, b: Spot): boolean {
  return a.side === b.side && a.pos === b.pos && a.index === b.index;
}

/** Drop where the pointer is; keyboard drags (no pointer) use the nearest target. */
const collision: CollisionDetection = (args) =>
  args.pointerCoordinates ? pointerWithin(args) : closestCenter(args);

type Props = {
  list: LoadedList;
  team: Team;
  onChange: (team: Team) => void;
  onNotice: (message: string) => void;
  children: ReactNode;
};

/**
 * Owns every lineup edit in the builder: drag and drop (mouse; touch with press-and-hold so
 * the page still scrolls; keyboard with Space to pick up, arrows to jump between spots, Space
 * to drop) and tap-to-place. Every edit goes through the shared lineup rules; a refused one
 * snaps back with the reason.
 */
export function Lineup({ list, team, onChange, onNotice, children }: Props) {
  const [selected, setSelected] = useState<Selection>(null);
  const [dragging, setDragging] = useState<CharId | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    // Space starts a keyboard drag; Enter is left for tap-to-place (select, Tab, Enter).
    useSensor(KeyboardSensor, {
      coordinateGetter: jumpToNearestSpot,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    }),
  );

  const charAt = (spot: Spot) => team[spot.side].depth[spot.pos]?.[spot.index] ?? null;
  const name = (id: CharId | null) => (id && list.byId.get(id)?.name) || "nobody";

  const apply = (result: Result) => {
    if (result.ok) {
      onChange(result.team);
      setSelected(null);
    } else onNotice(result.reason);
  };

  // Stable, so memoized pool cards don't re-render when the team changes.
  const selectPool = useCallback(
    (id: CharId) =>
      setSelected((s) => (s?.kind === "pool" && s.id === id ? null : { kind: "pool", id })),
    [],
  );

  const value: LineupValue = {
    list,
    team,
    sides: usage(team),
    selected,
    selectPool,
    activateSpot: (spot) => {
      if (selected?.kind === "pool") return apply(place(team, list.byId, selected.id, spot));
      if (selected?.kind === "spot") {
        if (sameSpot(selected.spot, spot)) return setSelected(null);
        return apply(move(team, list.byId, selected.spot, spot));
      }
      if (charAt(spot)) setSelected({ kind: "spot", spot });
    },
    removeSelected: () => {
      if (selected?.kind !== "spot") return;
      onChange(remove(team, selected.spot));
      setSelected(null);
    },
    clearSelection: () => setSelected(null),
  };

  const describe = (id: string | number | undefined) => {
    if (id === undefined) return "nowhere";
    if (id === POOL_DROP) return "the pool";
    const spot = parseSpotId(id);
    return spot ? `${spot.side} ${spotLabel(spot)}` : "the pool";
  };
  const activeName = (id: string | number) => {
    const spot = parseSpotId(id);
    return name(spot ? charAt(spot) : parsePoolId(id));
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${activeName(active.id)} from ${describe(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${activeName(active.id)} is over ${describe(over.id)}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `Dropped ${activeName(active.id)} on ${describe(over.id)}.`
        : `${activeName(active.id)} returned to ${describe(active.id)}.`,
    onDragCancel: ({ active }) => `Cancelled. ${activeName(active.id)} stays put.`,
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    setSelected(null);
    const spot = parseSpotId(active.id);
    setDragging(spot ? charAt(spot) : parsePoolId(active.id));
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    if (!over) return;
    const fromSpot = parseSpotId(active.id);
    const fromPool = parsePoolId(active.id);
    const to = parseSpotId(over.id);
    if (over.id === POOL_DROP) {
      if (fromSpot) onChange(remove(team, fromSpot));
    } else if (to && fromSpot) apply(move(team, list.byId, fromSpot, to));
    else if (to && fromPool) apply(place(team, list.byId, fromPool, to));
  };

  const character = dragging ? list.byId.get(dragging) : undefined;

  return (
    <LineupContext.Provider value={value}>
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
        accessibility={{ announcements }}
      >
        {children}
        <DragOverlay dropAnimation={null}>
          {character ? (
            <div className="drag-overlay">
              <Sprite list={list} index={character.atlasIndex} size={40} />
              <span>{character.name}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </LineupContext.Provider>
  );
}
