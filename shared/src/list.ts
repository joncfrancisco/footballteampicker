import { z } from "zod";

/** One character in a list. Its portrait is tile `atlasIndex` of the list's atlas. */
export const Character = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  subtitle: z.string().max(120).optional(),
  tags: z.array(z.string().max(40)).max(10).default([]),
  /** May play offense and defense. Set per character by the list creator. */
  twoWay: z.boolean().default(false),
  atlasIndex: z.number().int().nonnegative(),
});
export type Character = z.infer<typeof Character>;

/** All of a list's portraits in one image, row-major, `columns` tiles per row. */
export const Atlas = z.object({
  src: z.string().min(1),
  tile: z.number().int().positive(),
  columns: z.number().int().positive(),
  count: z.number().int().nonnegative(),
});
export type Atlas = z.infer<typeof Atlas>;

export const CharacterList = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1).max(100),
    ip: z.string().min(1).max(100),
    description: z.string().max(500).default(""),
    tags: z.array(z.string().max(40)).max(20).default([]),
    source: z.object({ provider: z.string(), version: z.string() }).optional(),
    /** Must be shown wherever the list appears (e.g. Riot's fan-content policy). */
    disclaimer: z.string().max(500).optional(),
    atlas: Atlas,
    characters: z.array(Character).min(1).max(200),
  })
  .superRefine((list, ctx) => {
    const ids = new Set<string>();
    list.characters.forEach((c, i) => {
      if (ids.has(c.id)) {
        ctx.addIssue({ code: "custom", path: ["characters", i, "id"], message: "duplicate id" });
      }
      ids.add(c.id);
      if (c.atlasIndex >= list.atlas.count) {
        ctx.addIssue({
          code: "custom",
          path: ["characters", i, "atlasIndex"],
          message: "outside the atlas",
        });
      }
    });
  });
export type CharacterList = z.infer<typeof CharacterList>;
