import { SPECIAL_TEAMS_ROWS, STAFF_ROLES, STAFF_TITLES, type Spot } from "@ftp/shared";
import { useLineup } from "../dnd/Lineup";
import { useSpot } from "../dnd/useSpot";
import { Sprite } from "../Sprite";

/** Front office: one tile per staff role, above the field. */
export function StaffStrip() {
  return (
    <section className="section-strip staff-strip" aria-label="Staff" data-testid="staff">
      <h2>Front office</h2>
      <div className="section-tiles">
        {STAFF_ROLES.map((role) => (
          <SectionTile
            key={role}
            spot={{ side: "staff", pos: role, index: 0 }}
            title={STAFF_TITLES[role]}
          />
        ))}
      </div>
    </section>
  );
}

/** Special teams: K, P, LS, H, KR ×2, PR ×2. No kickoff/punt formations in v1. */
export function SpecialTeamsPanel() {
  return (
    <section className="section-strip" aria-label="Special teams" data-testid="special-teams">
      <h2>Special teams</h2>
      <div className="section-tiles">
        {Object.entries(SPECIAL_TEAMS_ROWS).flatMap(([pos, n]) =>
          Array.from({ length: n }, (_, index) => (
            <SectionTile key={`${pos}${index}`} spot={{ side: "specialTeams", pos, index }} />
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
