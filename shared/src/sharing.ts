import { z } from "zod";
import { Atlas } from "./list";
import { TeamV1Input, TeamV2Input, teamErrors } from "./schemas";
import { upgradeTeam, type Team } from "./team";

const published = {
  id: z.string().regex(/^[A-Za-z0-9]{10}$/),
  listVersion: z.number().int().nonnegative(),
  listTitle: z.string(),
  atlas: Atlas,
  characters: z.record(
    z.string(),
    z.object({ name: z.string(), twoWay: z.boolean(), atlasIndex: z.number().int().nonnegative() }),
  ),
  disclaimer: z.string().optional(),
  createdAt: z.string(),
};

/**
 * A team as published to /m/t/<id>.json. Links are forever, so schema 1 (football before #44)
 * is read alongside schema 2 and upgraded to the current shape.
 */
export const PublishedTeam = z
  .union([
    TeamV2Input.extend({ ...published, schema: z.literal(2) }),
    TeamV1Input.extend({ ...published, schema: z.literal(1) }).transform((t) => upgradeTeam(t)),
  ])
  .superRefine((saved, ctx) => {
    const roster = new Map(
      Object.entries(saved.characters).map(([id, c]) => [id, { ...c, id, tags: [] }]),
    );
    for (const message of teamErrors(saved as Team, roster))
      ctx.addIssue({ code: "custom", message });
    for (const c of Object.values(saved.characters))
      if (c.atlasIndex >= saved.atlas.count)
        ctx.addIssue({ code: "custom", message: "outside atlas" });
  });
export type PublishedTeam = z.infer<typeof PublishedTeam>;
