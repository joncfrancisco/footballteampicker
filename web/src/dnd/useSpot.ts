import { useDraggable, useDroppable } from "@dnd-kit/core";
import { at, sideName, type Spot } from "@ftp/shared";
import { spotId, spotLabel } from "./ids";
import { sameSpot, useLineup } from "./Lineup";

/**
 * Everything a depth spot needs, wherever it's drawn (field slot or depth chart cell): it's
 * a drop target, it can be dragged when filled, and tapping it places or moves the current
 * selection, or selects whoever is in it.
 */
export function useSpot(spot: Spot) {
  const { list, team, sport, selected, activateSpot, readOnly } = useLineup();
  const id = spotId(spot);
  const charId = at(team, spot);
  const character = charId ? list.byId.get(charId) : undefined;
  const drop = useDroppable({ id, disabled: readOnly });
  const drag = useDraggable({ id, disabled: readOnly || !character });
  const label = spotLabel(spot, sport);
  const isSelected = selected?.kind === "spot" && sameSpot(selected.spot, spot);

  return {
    character,
    label,
    isOver: drop.isOver,
    isDragging: drag.isDragging,
    isSelected,
    /** Something is selected and could go here. */
    isTarget: !!selected && !isSelected,
    setNodeRef: (el: HTMLElement | null) => {
      drop.setNodeRef(el);
      drag.setNodeRef(el);
    },
    buttonProps: {
      type: "button" as const,
      disabled: readOnly,
      // An empty spot isn't draggable, but it's still a live button (tap to place), so it
      // mustn't pick up dnd-kit's aria-disabled / "draggable" description.
      ...(character && !readOnly ? { ...drag.attributes, ...drag.listeners } : {}),
      "aria-label": character
        ? `${character.name}, ${sideName(sport, spot.side)} ${label}`
        : `Empty ${sideName(sport, spot.side)} ${label}`,
      "aria-pressed": isSelected,
      onClick: () => activateSpot(spot),
    },
  };
}
