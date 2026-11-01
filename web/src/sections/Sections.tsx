import type { SectionDef, Spot } from "@ftp/shared";
import { useLineup } from "../dnd/Lineup";
import { useSpot } from "../dnd/useSpot";
import { Sprite } from "../Sprite";

/** Front office: one tile per staff role, above the field. */
export function StaffStrip({ section }: { section: SectionDef }) {
  return (
    <section className="section-strip staff-strip" aria-label="Staff" data-testid="staff">
      <h2>Front office</h2>
      <div className="section-tiles">
        {Object.keys(section.rows).map((role) => (
          <SectionTile
            key={role}
            spot={{ side: section.id, pos: role, index: 0 }}
            title={section.titles?.[role]}
          />
        ))}
      </div>
    </section>
  );
}

/** A situational section (special teams...): one tile per spot. No formations for these. */
export function SectionPanel({ section }: { section: SectionDef }) {
  return (
    <section
      className="section-strip"
      aria-label={section.name}
      data-testid={section.id.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}
    >
      <h2>{section.name}</h2>
      <div className="section-tiles">
        {Object.entries(section.rows).flatMap(([pos, n]) =>
          Array.from({ length: n }, (_, index) => (
            <SectionTile
              key={`${pos}${index}`}
              spot={{ side: section.id, pos, index }}
              title={section.titles?.[pos]}
            />
          )),
        )}
      </div>
    </section>
  );
}

function SectionTile({ spot, title }: { spot: Spot; title?: string }) {
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
      title={`${title ?? s.label}${s.character ? `: ${s.character.name}` : ""}`}
    >
      {s.character ? (
        <Sprite list={list} index={s.character.atlasIndex} size={40} />
      ) : (
        <span className="section-empty" aria-hidden="true" />
      )}
      <span className="section-text">
        <span className="section-name">
          {s.character?.name ?? "Open"}
          {s.character?.twoWay && <span className="two-way-text"> 2W</span>}
        </span>
        <span className="section-label">{s.label}</span>
      </span>
    </button>
  );
}
