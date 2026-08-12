/**
 * Corridor manifest schema — the repeatable authored-content contract that
 * makes a corridor a CONTENT addition rather than an engineering project.
 *
 * Two ideas carry the whole file:
 *
 *   1. REQUIRED STRUCTURAL DATA vs OPTIONAL FINAL ART.
 *      Traversal anchors, occlusion zones and the gold route define whether a
 *      corridor is *coherent*. Paintings, effects and video define whether it
 *      is *finished*. A corridor pack can be structurally valid while its
 *      final art is still being produced — that is an `authoring` corridor,
 *      and it is explicitly NOT production-playable.
 *
 *   2. A corridor never becomes production-playable by accident.
 *      `stage: "playable"` is a claim the manifest makes about itself, and
 *      the schema enforces that claim: a playable corridor must actually
 *      carry the art a playable corridor needs. An `authoring` corridor may
 *      omit art, but the runtime refuses to boot it as the live world.
 *
 * corridor_01's shipped manifest predates `stage`, so `stage` defaults to
 * "playable" — the existing pack keeps validating exactly as before.
 */
import { z } from "zod";

/**
 * Where a corridor is in its production lifecycle.
 *
 * `playable`  — structurally valid AND carries its required final art. May
 *               be loaded as the live world.
 * `authoring` — structurally valid, art incomplete. Loadable by dev/validation
 *               tooling so the traversal contract can be authored and tested,
 *               never served as the live world.
 */
export const CORRIDOR_STAGES = ["playable", "authoring"] as const;
export type CorridorStage = (typeof CORRIDOR_STAGES)[number];

/**
 * Final art. Every field is nullable at the schema level because an
 * `authoring` corridor legitimately has none of it yet; `stage: "playable"`
 * is what promotes `mid` from "nullable" to "must actually be there".
 */
export const corridorAssetsSchema = z.object({
  far: z.string().min(1).nullable(),
  mid: z.string().min(1).nullable(),
  foreground: z.string().min(1).nullable(),
  effects: z.string().min(1).nullable(),
  portal: z.string().min(1).nullable(),
  stronghold: z.string().min(1).nullable(),
  waterfallVideo: z.string().min(1).nullable(),
});

/**
 * Structural data — required at every stage. These three files are what make
 * a corridor traversable at all: where the player can go, what occludes them,
 * and the line the gold route follows.
 */
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

const corridorPositionSchema = z.object({
  progress: z.number().min(0).max(1),
  lateral: z.number().min(-1).max(1),
});

/**
 * A semantic landmark the world can stage an encounter against. `archetype`
 * is the same ANCHOR/GATEKEEPER/GHOST/STALLER vocabulary the encounters and
 * Armory already speak, so a corridor declares what it can physically host
 * rather than the renderer hardcoding corridor_01's layout.
 */
export const corridorLandmarkSchema = z.object({
  id: z.string().min(1),
  archetype: z.enum(["ANCHOR", "GATEKEEPER", "GHOST", "STALLER"]).nullable(),
  position: corridorPositionSchema,
});

/**
 * What a corridor is physically able to host. The projection layer reads
 * this to answer "can this real mission actually be staged here?" — it never
 * invents a capability a corridor did not declare.
 */
export const corridorCapabilitiesSchema = z.object({
  /** Can stage a Cold Call comms portal (requires a portal anchor + art). */
  coldCallPortal: z.boolean().default(false),
  /** Has a destination/Stronghold the ANCHOR encounter can frame. */
  stronghold: z.boolean().default(false),
  /** Mission source kinds this corridor is authored to represent. */
  missionSources: z
    .array(z.enum(["field", "cold_call", "recovery", "scout"]))
    .default([]),
});

/**
 * Load-priority hints. `critical` must resolve before the corridor is
 * considered presentable; everything else settles in afterward so the world
 * appears fast and finishes dressing itself while the player already has
 * control.
 */
export const corridorLoadPrioritySchema = z.object({
  critical: z.array(z.string().min(1)).default([]),
  deferred: z.array(z.string().min(1)).default([]),
});

export const corridorManifestSchema = z
  .object({
    id: z.string().min(1),
    version: z.number().int().min(1),
    stage: z.enum(CORRIDOR_STAGES).default("playable"),
    assets: corridorAssetsSchema,
    data: corridorDataFilesSchema,
    parallax: corridorParallaxSchema,
    qualityVariants: z.array(corridorQualityVariantSchema).min(1),
    landmarks: z.array(corridorLandmarkSchema).default([]),
    capabilities: corridorCapabilitiesSchema.default({
      coldCallPortal: false,
      stronghold: false,
      missionSources: [],
    }),
    loadPriority: corridorLoadPrioritySchema.default({
      critical: [],
      deferred: [],
    }),
  })
  .superRefine((manifest, ctx) => {
    // The whole point of `stage`: claiming to be playable is a claim that
    // the art actually exists. `mid` is the one layer with no fallback —
    // without it there is no corridor to walk through.
    if (manifest.stage === "playable" && manifest.assets.mid === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assets", "mid"],
        message:
          "a corridor with stage 'playable' must supply assets.mid; use stage 'authoring' while final art is outstanding",
      });
    }
    // A corridor cannot claim a capability it has no anchor to hang it on.
    if (manifest.capabilities.coldCallPortal && manifest.assets.portal === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capabilities", "coldCallPortal"],
        message:
          "capabilities.coldCallPortal requires assets.portal — a corridor cannot host a portal it has no art for",
      });
    }
    if (manifest.capabilities.stronghold && manifest.assets.stronghold === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capabilities", "stronghold"],
        message:
          "capabilities.stronghold requires assets.stronghold — a corridor cannot host a Stronghold it has no art for",
      });
    }
    const landmarkIds = new Set<string>();
    for (const landmark of manifest.landmarks) {
      if (landmarkIds.has(landmark.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["landmarks"],
          message: `duplicate landmark id '${landmark.id}'`,
        });
      }
      landmarkIds.add(landmark.id);
    }
  });

export type CorridorManifest = z.infer<typeof corridorManifestSchema>;
export type CorridorLandmark = z.infer<typeof corridorLandmarkSchema>;
export type CorridorCapabilities = z.infer<typeof corridorCapabilitiesSchema>;

export function parseCorridorManifest(payload: unknown) {
  return corridorManifestSchema.safeParse(payload);
}

/**
 * True only for a corridor that both claims playability and validated as
 * such. The runtime uses this as its final gate — a structurally-valid
 * authoring corridor is still refused as the live world.
 */
export function isProductionPlayable(manifest: CorridorManifest): boolean {
  return manifest.stage === "playable";
}

/**
 * Which optional final art a corridor is still missing. Reported honestly by
 * tooling so "corridor_02 is engineering-complete but visually blocked" is a
 * statement backed by data rather than a claim.
 */
export function missingOptionalArt(manifest: CorridorManifest): string[] {
  const missing: string[] = [];
  const optional: Array<[string, string | null]> = [
    ["far", manifest.assets.far],
    ["foreground", manifest.assets.foreground],
    ["effects", manifest.assets.effects],
    ["portal", manifest.assets.portal],
    ["stronghold", manifest.assets.stronghold],
    ["waterfallVideo", manifest.assets.waterfallVideo],
  ];
  for (const [name, value] of optional) {
    if (value === null) missing.push(name);
  }
  return missing;
}
