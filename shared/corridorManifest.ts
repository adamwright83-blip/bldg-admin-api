/**
 * Corridor manifest schema — the repeatable authored-content contract this
 * run's product notes asked for. Validated with zod so a malformed future
 * corridor fails loudly and specifically rather than rendering corrupted.
 *
 * This describes corridor_01's existing asset/data layout; it does not
 * change how GoldlineGame.ts loads assets today (those call sites are
 * stable and tested). It exists so `scripts/validateCorridorManifest.mjs`
 * can check a corridor pack — including a future corridor_02 — before it
 * ever reaches the runtime.
 */
import { z } from "zod";

export const corridorAssetsSchema = z.object({
  far: z.string().min(1).nullable(),
  mid: z.string().min(1),
  foreground: z.string().min(1).nullable(),
  effects: z.string().min(1).nullable(),
  portal: z.string().min(1).nullable(),
  stronghold: z.string().min(1).nullable(),
  waterfallVideo: z.string().min(1).nullable(),
});

export const corridorDataFilesSchema = z.object({
  traversal: z.string().min(1),
  occlusion: z.string().min(1),
  goldRoute: z.string().min(1),
});

export const corridorParallaxSchema = z.object({
  far: z.number().min(0.05).max(0.15),
  mid: z.number().min(0.3).max(0.6).optional(),
});

export const corridorQualityVariantSchema = z.object({
  id: z.enum(["premium", "reduced"]),
  /** Optional lighter asset overrides for this quality level. */
  assets: corridorAssetsSchema.partial().optional(),
});

export const corridorManifestSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().min(1),
  assets: corridorAssetsSchema,
  data: corridorDataFilesSchema,
  parallax: corridorParallaxSchema,
  qualityVariants: z.array(corridorQualityVariantSchema).min(1),
});

export type CorridorManifest = z.infer<typeof corridorManifestSchema>;

export function parseCorridorManifest(payload: unknown) {
  return corridorManifestSchema.safeParse(payload);
}
