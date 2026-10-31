import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  closestCenter,
  pointerWithin,
  type CollisionDetection,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { move, type Spot, type Team } from "@ftp/shared";
import { useState, type ReactNode } from "react";
import type { LoadedList } from "../lists";
import { Sprite } from "../Sprite";
import { parseSpotId, spotLabel } from "./ids";

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
 * The drag-and-drop context for the builder: mouse, touch (press and hold, so the page still
 * scrolls) and keyboard (Space to pick up, arrows to move, Space to drop). Every drop goes
 * through the shared lineup rules; a refused drop snaps back with the reason.
 */
export function LineupDnd({ list, team, onChange, onNotice, children }: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const nameAt = (spot: Spot | null) => {
    const id = spot && team[spot.side].depth[spot.pos]?.[spot.index];
    return (id && list.byId.get(id)?.name) || "nobody";
  };
  const describe = (id: string | number | undefined) => {
    const spot = id === undefined ? null : parseSpotId(id);
    return spot ? `${spot.side} ${spotLabel(spot)}` : "nowhere";
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Picked up ${nameAt(parseSpotId(active.id))} from ${describe(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${nameAt(parseSpotId(active.id))} is over ${describe(over.id)}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `Dropped ${nameAt(parseSpotId(active.id))} on ${describe(over.id)}.`
        : `${nameAt(parseSpotId(active.id))} returned to ${describe(active.id)}.`,
    onDragCancel: ({ active }) => `Cancelled. ${nameAt(parseSpotId(active.id))} stays put.`,
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    const spot = parseSpotId(active.id);
    setDragging((spot && team[spot.side].depth[spot.pos]?.[spot.index]) ?? null);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    const from = parseSpotId(active.id);
    const to = over && parseSpotId(over.id);
    if (!from || !to) return;
    const result = move(team, list.byId, from, to);
    if (result.ok) onChange(result.team);
    else onNotice(result.reason);
  };

  const character = dragging ? list.byId.get(dragging) : undefined;

  return (
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
  );
}
