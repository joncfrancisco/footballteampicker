import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { Character, CharId } from "@ftp/shared";
import { memo, useMemo, useState } from "react";
import { POOL_DROP, poolId } from "../dnd/ids";
import { useLineup } from "../dnd/Lineup";
import type { LoadedList } from "../lists";
import { Sprite } from "../Sprite";

/**
 * Every character in the list. Drag a card onto a spot, or tap it and then tap a spot.
 * Dropping a placed character back here takes them off the team.
 */
export function Pool() {
  const { list, sides, selected, selectPool } = useLineup();
  const [query, setQuery] = useState("");
  const [tags, setTags] = useState<ReadonlySet<string>>(new Set());
  const [twoWayOnly, setTwoWayOnly] = useState(false);
  const [unusedOnly, setUnusedOnly] = useState(false);
  const drop = useDroppable({ id: POOL_DROP });

  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return list.characters.filter(
      (c) =>
        (!q || c.name.toLocaleLowerCase().includes(q)) &&
        (tags.size === 0 || c.tags.some((t) => tags.has(t))) &&
        (!twoWayOnly || c.twoWay) &&
        (!unusedOnly || !sides.has(c.id)),
    );
  }, [list, query, tags, twoWayOnly, unusedOnly, sides]);

  const toggleTag = (tag: string) =>
    setTags((current) => {
      const next = new Set(current);
      if (!next.delete(tag)) next.add(tag);
      return next;
    });

  return (
    <aside
      ref={drop.setNodeRef}
      className={`pool${drop.isOver ? " over" : ""}`}
      aria-label="Character pool"
      data-testid="pool"
    >
      <div className="pool-filters">
        <input
          type="search"
          placeholder="Search characters"
          aria-label="Search characters"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="pool-tags" role="group" aria-label="Filter by tag">
          {list.tags.map((tag) => (
            <button
              key={tag}
              type="button"
              aria-pressed={tags.has(tag)}
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
        <label>
          <input
            type="checkbox"
            checked={twoWayOnly}
            onChange={(e) => setTwoWayOnly(e.target.checked)}
          />{" "}
          Two-way only
        </label>
        <label>
          <input
            type="checkbox"
            checked={unusedOnly}
            onChange={(e) => setUnusedOnly(e.target.checked)}
          />{" "}
          Unused
        </label>
      </div>
      <p className="pool-count">
        {shown.length === list.characters.length
          ? `${shown.length} characters`
          : `${shown.length} of ${list.characters.length}`}
      </p>
      <ul className="pool-grid">
        {shown.map((c) => (
          <li key={c.id}>
            <PoolCard
              list={list}
              character={c}
              plays={plays(sides.get(c.id))}
              selected={selected?.kind === "pool" && selected.id === c.id}
              onSelect={selectPool}
            />
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** "O", "D", "OD" or "" for where a character already plays. */
function plays(s: Set<string> | undefined): string {
  return s ? `${s.has("offense") ? "O" : ""}${s.has("defense") ? "D" : ""}` : "";
}

const PoolCard = memo(function PoolCard(props: {
  list: LoadedList;
  character: Character;
  plays: string;
  selected: boolean;
  onSelect: (id: CharId) => void;
}) {
  const { list, character: c, plays, selected, onSelect } = props;
  const drag = useDraggable({ id: poolId(c.id) });
  const where = plays === "OD" ? "offense and defense" : plays === "O" ? "offense" : "defense";
  return (
    <button
      ref={drag.setNodeRef}
      type="button"
      {...drag.attributes}
      {...drag.listeners}
      className={`pool-card${selected ? " selected" : ""}${drag.isDragging ? " dragging" : ""}`}
      aria-pressed={selected}
      aria-label={`${c.name}${c.twoWay ? ", two-way" : ""}${plays ? `, plays ${where}` : ""}`}
      title={c.subtitle ? `${c.name}, ${c.subtitle}` : c.name}
      data-character={c.id}
      onClick={() => onSelect(c.id)}
    >
      <Sprite list={list} index={c.atlasIndex} size={48} />
      <span className="pool-name">{c.name}</span>
      {c.twoWay && <span className="badge two-way">2W</span>}
      {plays && <span className="badge plays">{plays}</span>}
    </button>
  );
});
