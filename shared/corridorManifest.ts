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
 * Presentation-only people authored into a corridor. These records describe
 * where a generic role figure may stand and how it may move; they deliberately
 * have no mission/contact/account vocabulary. `.strict()` is load-bearing:
 * accidental business fields fail validation instead of being silently
 * stripped and later mistaken for trusted input.
 */
export const corridorAmbientPersonSchema = z
  .object({
    id: z.string().min(1),
    spriteId: z.string().min(1),
    position: corridorPositionSchema,
    depthLayer: z.enum(["L1", "L2", "L3"]).default("L2"),
    facing: z.enum(["left", "right", "forward"]).default("forward"),
    behavior: z.enum([
      "idle",
      "walk",
      "phone",
      "talk",
      "clipboard",
      "carry",
      "stall",
      "sit",
      "railing",
    ]),
    path: z.array(corridorPositionSchema).max(6).default([]),
    visibilityRadius: z.number().min(0.08).max(1).default(0.42),
    occlusionRule: z.enum(["world", "foreground", "none"]).default("world"),
  })
  .strict();

/**
 * An authored spatial slot to which live mission projection may bind. It is
 * not a mission definition and cannot remember business truth. The server
 * supplies the mission; this contract supplies only space and framing.
 */
export const corridorMissionAnchorPointSchema = z
  .object({
    id: z.string().min(1),
    position: corridorPositionSchema,
    facing: z.enum(["left", "right", "forward"]).default("forward"),
    stagingRadius: z.number().min(0.02).max(0.3),
    capacity: z.number().int().min(1).max(2).default(1),
    cameraBias: z.number().min(-1).max(1).default(0),
    cameraLift: z.number().min(0).max(0.4).default(0.12),
    nearbyAmbientCompatibility: z
      .array(corridorAmbientPersonSchema.shape.behavior)
      .default([]),
  })
  .strict();

export const corridorPopulationSchema = z
  .object({
    /** Final WebP atlas is asset-gated; vector fallback is engineering-only. */
    assetStage: z.enum(["production", "engineering_placeholder"]),
    atlas: z.string().min(1).nullable(),
    ambient: z.array(corridorAmbientPersonSchema).max(12).default([]),
    missionAnchorPoints: z
      .array(corridorMissionAnchorPointSchema)
      .max(12)
      .default([]),
  })
  .strict();

export const corridorVisualReviewSchema = z
  .object({
    status: z.enum(["approved", "pending"]),
    reviewedAt: z.string().min(1).nullable(),
    reviewer: z.string().min(1).nullable(),
  })
  .strict();

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
    population: corridorPopulationSchema.default({
      assetStage: "engineering_placeholder",
      atlas: null,
      ambient: [],
      missionAnchorPoints: [],
    }),
    visualReview: corridorVisualReviewSchema,
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
    if (
      manifest.stage === "playable" &&
      (manifest.visualReview.status !== "approved" ||
        manifest.visualReview.reviewedAt === null ||
        manifest.visualReview.reviewer === null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["visualReview"],
        message:
          "a playable corridor requires explicit human visual approval metadata",
      });
    }
    // A corridor cannot claim a capability it has no anchor to hang it on.
    if (
      manifest.capabilities.coldCallPortal &&
      manifest.assets.portal === null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capabilities", "coldCallPortal"],
        message:
          "capabilities.coldCallPortal requires assets.portal — a corridor cannot host a portal it has no art for",
      });
    }
    if (
      manifest.capabilities.stronghold &&
      manifest.assets.stronghold === null
    ) {
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
    if (
      manifest.population.assetStage === "production" &&
      manifest.population.atlas === null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["population", "atlas"],
        message: "production population requires a final atlas",
      });
    }
    const populationIds = new Set<string>();
    for (const person of manifest.population.ambient) {
      if (populationIds.has(person.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["population", "ambient"],
          message: `duplicate ambient id '${person.id}'`,
        });
      }
      populationIds.add(person.id);
    }
    const missionAnchorIds = new Set<string>();
    for (const anchor of manifest.population.missionAnchorPoints) {
      if (missionAnchorIds.has(anchor.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["population", "missionAnchorPoints"],
          message: `duplicate mission anchor id '${anchor.id}'`,
        });
      }
      missionAnchorIds.add(anchor.id);
    }
  });

export type CorridorManifest = z.infer<typeof corridorManifestSchema>;
export type CorridorLandmark = z.infer<typeof corridorLandmarkSchema>;
export type CorridorCapabilities = z.infer<typeof corridorCapabilitiesSchema>;
export type CorridorAmbientPerson = z.infer<typeof corridorAmbientPersonSchema>;
export type CorridorMissionAnchorPoint = z.infer<
  typeof corridorMissionAnchorPointSchema
>;
export type CorridorPopulation = z.infer<typeof corridorPopulationSchema>;
export type CorridorVisualReview = z.infer<typeof corridorVisualReviewSchema>;

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
