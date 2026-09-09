import { z } from "zod";

/**
 * Cross-device Goldline chapter fiction state (Slice 3 contract from
 * docs/goldline/HANDOFF-FIRST-2_5D-CHAPTER.md section 4). Fiction only —
 * never a business record. Server derives tenant/operator from auth; this
 * schema never carries ownership fields.
 */
export const goldlineChapterFictionStateSchema = z.object({
  chapterId: z.string().min(1).max(64),
  version: z.literal(1),
  room: z.string().min(1).max(32),
  checkpoint: z.object({
    room: z.string().min(1).max(32),
    x: z.number(),
    y: z.number(),
  }),
  mechanism: z.object({
    heading: z.enum(["bridge", "latch", "confrontation"]).nullable(),
    gardenOpen: z.boolean(),
    latchOpen: z.boolean(),
  }),
  cleared: z.array(z.string().min(1).max(32)).max(8),
  completed: z.boolean(),
  choice: z.enum(["preserve", "break"]).nullable(),
  restored: z.boolean(),
  secretSeen: z.boolean(),
});
export type GoldlineChapterFictionState = z.infer<
  typeof goldlineChapterFictionStateSchema
>;
