import { z } from "zod";
import { Atlas } from "./list";
import { TeamInput, teamErrors } from "./schemas";
import type { Team } from "./team";

export const PublishedTeam = TeamInput.extend({
  schema: z.literal(1),
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
}).superRefine((saved, ctx) => {
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
