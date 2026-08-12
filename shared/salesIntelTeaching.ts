/**
 * General sales teaching — Layer A, broadened.
 *
 * The original `sales_intel_frameworks` table only represents one kind of
 * teaching: an objection-handling framework (archetype + channel + exact
 * objection, mandatory). Real trainers teach far more than objection
 * handling — prospecting, discovery, positioning, closing, follow-up — and
 * forcing all of it into that schema either discards legitimate teaching
 * (an extractor told "return empty if this isn't about objections" simply
 * throws everything else away) or contaminates a working, tested schema
 * with dozens of nullable objection-specific fields for content that was
 * never about objections in the first place.
 *
 * This module is the general-purpose teaching entity. It is source-faithful
 * (never invents content, always traceable to a transcript/segment) and
 * deliberately does NOT require a Goldline archetype or an exact objection —
 * `objectionMapping` is optional, and when a real, source-supported mapping
 * exists it is persisted as its own independent `salesIntelFrameworks` row
 * through the existing pipeline (own review state, own acceptance) rather
 * than smuggled into this table as an implied acceptance.
 *
 * Imported by the client bundle — no node builtins here (hashing lives in
 * server/salesIntel/salesIntelIdentity.ts, matching shared/salesIntel.ts's
 * own convention).
 */
import { z } from "zod";
import {
  SALES_INTEL_CHANNELS,
  OBJECTION_ARCHETYPES,
  type SalesIntelChannel,
  type SalesIntelPhrase,
  type SalesIntelReviewState,
  type ObjectionArchetype,
} from "./salesIntel";

/**
 * A manageable vocabulary, not an exhaustive taxonomy. Covers the sales
 * motion end to end (prospecting through re-engagement) plus two escape
 * hatches: `sales_process` for structural/pipeline teaching that isn't a
 * single move, and `other` for anything genuinely uncategorizable rather
 * than forcing a bad fit.
 */
export const SALES_INTEL_TEACHING_CATEGORIES = [
  "prospecting",
  "opening",
  "positioning",
  "rapport",
  "discovery",
  "qualification",
  "questioning",
  "value",
  "pricing",
  "objection_prevention",
  "objection_handling",
  "negotiation",
  "closing",
  "follow_up",
  "re_engagement",
  "sales_process",
  "sales_psychology",
  "other",
] as const;

export type SalesIntelTeachingCategory =
  (typeof SALES_INTEL_TEACHING_CATEGORIES)[number];

/**
 * An optional, source-supported objection-handling mapping. When present,
 * the caller persists it as an independent `salesIntelFrameworks` row
 * through the existing pipeline — this is a candidate for that mapping,
 * never the mapping's acceptance state itself.
 */
export type SalesIntelTeachingObjectionMapping = {
  archetype: ObjectionArchetype;
  channel: SalesIntelChannel;
  exactObjection: string;
  frameworkName: string;
  responseFamily: string;
  discoveryQuestions: string[];
  whenToUse: string[];
  whenNotToUse: string[];
  followUpMoves: string[];
  badResponses: string[];
};

export type SalesIntelTeaching = {
  id: string;
  sourceArtifactId: string;
  transcriptId: string;
  teachingKey: string;
  creatorName: string;
  creatorHandle: string | null;
  category: SalesIntelTeachingCategory;
  title: string;
  principle: string;
  whenToUse: string[];
  whenNotToUse: string[];
  exampleLanguage: SalesIntelPhrase[];
  confidence: number | null;
  extractionVersion: string;
  extractionProvider: string | null;
  extractionModel: string | null;
  promptVersion: string | null;
  /** Absolute (video-level) evidence range — the segment's own range, never invented finer-grained precision. */
  transcriptStartMs: number | null;
  transcriptEndMs: number | null;
  reviewState: SalesIntelReviewState;
  reviewedBy: string | null;
  reviewedAt: string | null;
  version: number;
  active: boolean;
  supersededAt: string | null;
  createdAt: string;
};

const phraseImportSchema = z.union([
  z.string().trim().min(1),
  z.object({
    kind: z.enum(["exact_source_phrase", "paraphrased_principle"]),
    text: z.string().trim().min(1),
  }),
]);

const objectionMappingImportSchema = z.object({
  archetype: z.enum(OBJECTION_ARCHETYPES),
  channel: z.enum(SALES_INTEL_CHANNELS),
  exactObjection: z.string().trim().min(1).max(1000),
  frameworkName: z.string().trim().min(1).max(191),
  responseFamily: z.string().trim().min(1).max(191),
  discoveryQuestions: z.array(z.string().trim().min(1)).max(6).default([]),
  whenToUse: z.array(z.string().trim().min(1)).max(6).default([]),
  whenNotToUse: z.array(z.string().trim().min(1)).max(6).default([]),
  followUpMoves: z.array(z.string().trim().min(1)).max(6).default([]),
  badResponses: z.array(z.string().trim().min(1)).max(6).default([]),
});

/** Raw extractor output for one teaching, before persistence-layer identity/provenance are attached. */
export const salesIntelTeachingImportSchema = z.object({
  category: z.enum(SALES_INTEL_TEACHING_CATEGORIES),
  title: z.string().trim().min(1).max(191),
  principle: z.string().trim().min(1),
  whenToUse: z.array(z.string().trim().min(1)).max(6).default([]),
  whenNotToUse: z.array(z.string().trim().min(1)).max(6).default([]),
  exampleLanguage: z.array(phraseImportSchema).max(6).default([]),
  confidence: z.number().min(0).max(1).nullable(),
  /** Present only when the transcript itself genuinely supports an objection-handling reading. */
  objectionMapping: objectionMappingImportSchema.nullable().default(null),
});

export type SalesIntelTeachingImport = z.infer<
  typeof salesIntelTeachingImportSchema
>;

export const salesIntelTeachingExtractionOutputSchema = z.object({
  teachings: z.array(salesIntelTeachingImportSchema).max(20),
});

/** Mirrors shared/salesIntel.ts's salesIntelFrameworkIdentityParts convention. */
export function salesIntelTeachingIdentityParts(input: {
  sourceArtifactId: string;
  transcriptId: string;
  category: SalesIntelTeachingCategory;
  title: string;
}): string[] {
  return [
    input.sourceArtifactId,
    input.transcriptId,
    input.category,
    input.title.trim().toLowerCase(),
  ];
}
