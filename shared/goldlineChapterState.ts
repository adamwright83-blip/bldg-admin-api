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
  /** Slice 5: the optional real-business-event binding. Never business truth itself. */
  prepared: z.object({
    armedAt: z.string().nullable(),
    resolvedEventId: z.string().nullable(),
  }),
  /** Slice 7: which way a real, already-recorded outcome has branched the fiction. */
  realOutcome: z.enum(["follow_up", "won", "lost"]).nullable(),
});
export type GoldlineChapterFictionState = z.infer<
  typeof goldlineChapterFictionStateSchema
>;
