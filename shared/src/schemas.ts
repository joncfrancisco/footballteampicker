import { z } from "zod";
import { formationById } from "./formations";
import { shapeErrors, violations, type Roster } from "./lineup";
import { FRONTS, STAFF_ROLES } from "./positions";
import type { Team } from "./team";

/**
 * Request bodies the API accepts (#9). Text is sanitised (control characters stripped,
 * whitespace trimmed) and capped: title 80, name 40, subtitle 60, description 500.
 */
const text = (max: number) =>
  z
    .string()
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .transform((s) => s.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim())
    .pipe(z.string().max(max));
const required = (max: number) => text(max).pipe(z.string().min(1));

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const charRef = id.nullable();
const depth = z.record(z.string().regex(/^[A-Z]{1,4}$/), z.array(charRef).max(6));

export const TeamInput = z.object({
  title: required(80),
  listId: id,
  /** The list version this team was built against; checked on save. */
  listVersion: z.number().int().nonnegative().optional(),
  offense: z.object({ depth, formation: id, qb: z.enum(["under", "gun"]).optional() }),
  defense: z.object({ front: z.enum(FRONTS), depth, formation: id }),
  specialTeams: depth.optional(),
  staff: z
    .object(Object.fromEntries(STAFF_ROLES.map((r) => [r, charRef])))
    .strict()
    .optional(),
});
export type TeamInput = z.infer<typeof TeamInput>;

export const ListCharacterInput = z.object({
  id,
  name: required(40),
  subtitle: text(60).optional(),
  tags: z.array(required(40)).max(10).default([]),
  twoWay: z.boolean().default(false),
  atlasIndex: z.number().int().nonnegative(),
});

export const ListInput = z
  .object({
    title: required(80),
    ip: required(80),
    description: text(500).default(""),
    tags: z.array(required(40)).max(20).default([]),
    visibility: z.enum(["public", "unlisted"]).default("unlisted"),
    seedId: id.optional(),
    uploadToken: z.string().max(100).optional(),
    baseVersion: z.number().int().positive().optional(),
    atlas: z.object({
      key: z
        .string()
        .regex(
          /^(?:tmp\/[A-Za-z0-9-]+|m\/(?:a\/[A-Za-z0-9_-]+\.webp|img\/[A-Za-z0-9]+\/atlas-[a-f0-9]+\.(?:webp|jpg)|seeds\/[A-Za-z0-9_-]+\/atlas-[a-f0-9]+\.webp))$/,
        ),
      tile: z.number().int().min(32).max(256),
      columns: z.number().int().min(1).max(32),
      count: z.number().int().min(11).max(200),
    }),
    characters: z.array(ListCharacterInput).min(11).max(200),
  })
  .superRefine((list, ctx) => {
    if (list.characters.length > 150 && !list.seedId)
      ctx.addIssue({ code: "custom", path: ["characters"], message: "150 characters maximum" });
    const seen = new Set<string>();
    list.characters.forEach((c, i) => {
      if (seen.has(c.id))
        ctx.addIssue({ code: "custom", path: ["characters", i, "id"], message: "duplicate id" });
      seen.add(c.id);
      if (c.atlasIndex >= list.atlas.count)
        ctx.addIssue({
          code: "custom",
          path: ["characters", i, "atlasIndex"],
          message: "outside the atlas",
        });
    });
  });
export type ListInput = z.infer<typeof ListInput>;

export const UploadInput = z.object({ contentType: z.enum(["image/webp", "image/jpeg"]) });

export const ReportInput = z.object({
  targetId: id,
  targetType: z.enum(["list", "team"]),
  reason: required(500),
});

/**
 * Everything wrong with a parsed team against its list, using the same rules as the builder:
 * formations exist and match the side and front, rows match the templates, and the lineup
 * rules hold. Empty means valid.
 */
export function teamErrors(team: Team, roster: Roster): string[] {
  const out: string[] = [];
  const off = formationById(team.offense.formation);
  const def = formationById(team.defense.formation);
  if (off?.side !== "offense") out.push(`Unknown offensive formation "${team.offense.formation}"`);
  if (def?.side !== "defense" || def.front !== team.defense.front)
    out.push(`"${team.defense.formation}" isn't a ${team.defense.front} formation`);
  if (team.offense.qb && !off?.altQb && team.offense.qb !== off?.qb)
    out.push(`${off?.name ?? "That formation"} has no ${team.offense.qb} option`);
  return [...out, ...shapeErrors(team), ...violations(team, roster)];
}
