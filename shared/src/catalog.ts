import { z } from "zod";
import { Atlas, CharacterList } from "./list";

/** Read models published to S3. Neither contains credentials or edit tokens. */
export const PublishedList = CharacterList.and(
  z.object({
    version: z.number().int().nonnegative(),
    visibility: z.enum(["public", "unlisted"]),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);
export type PublishedList = z.infer<typeof PublishedList>;

export const ListSummary = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  title: z.string(),
  ip: z.string(),
  description: z.string().default(""),
  tags: z.array(z.string()).default([]),
  count: z.number().int().nonnegative(),
  twoWayCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  atlas: Atlas,
  cover: z.array(z.number().int().nonnegative()).max(4),
  disclaimer: z.string().optional(),
});
export type ListSummary = z.infer<typeof ListSummary>;
export const BrowseIndex = z.object({ updatedAt: z.string(), lists: z.array(ListSummary) });
