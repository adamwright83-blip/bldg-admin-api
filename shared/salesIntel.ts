/**
 * Sales Intel — provenance-backed external sales intelligence.
 *
 * Two evidence layers are kept permanently distinct:
 *
 *   LAYER A  external trainer teaching  ("what does this trainer teach?")
 *   LAYER B  personal business evidence ("what happened when this player used it?")
 *
 * Layer A lives here and in the `sales_intel_*` tables. Layer B lives in
 * `armory_weapon_usages` and is tenant/actor scoped. Neither layer may
 * overwrite the other, and neither may assert a business result on its own —
 * only authoritative commercial state (missions, pipeline, follow-ups,
 * contacts) declares what actually happened.
 *
 * This module is imported by the client bundle, so it stays free of node
 * builtins: hashing lives in `server/salesIntel/salesIntelIdentity.ts`.
 */
import { z } from "zod";

export const OBJECTION_ARCHETYPES = [
  "ANCHOR",
  "GATEKEEPER",
  "GHOST",
  "STALLER",
] as const;

export type ObjectionArchetype = (typeof OBJECTION_ARCHETYPES)[number];

export const SALES_INTEL_CHANNELS = [
  "phone",
  "in_person",
  "follow_up",
  "proposal",
] as const;

export type SalesIntelChannel = (typeof SALES_INTEL_CHANNELS)[number];

export const SALES_INTEL_SOURCE_TYPES = [
  "manual_url",
  "instagram",
  "youtube",
  "podcast",
  "uploaded_transcript",
  "test_fixture",
  "other",
] as const;

export type SalesIntelSourceType = (typeof SALES_INTEL_SOURCE_TYPES)[number];

/**
 * `test_fixture` exists so deterministic synthetic material can never be
 * mistaken for real trainer teaching. Anything carrying this source type must
 * be labelled as a fixture everywhere it is displayed.
 */
export function isSyntheticSourceType(
  sourceType: SalesIntelSourceType
): boolean {
  return sourceType === "test_fixture";
}

/**
 * Real ingestion lifecycle.
 *
 *   received          source accepted with content present, not yet processed
 *   awaiting_content  source stored and traceable, but no transcript or
 *                     authorized media exists yet (the honest Instagram
 *                     URL-only state)
 *   processing        analysis/transcription in flight
 *   analyzed          a transcript or video analysis exists
 *   extracted         normalized frameworks were produced
 *   failed            processing failed; the source artifact is preserved
 */
export const SALES_INTEL_SOURCE_STATUSES = [
  "received",
  "awaiting_content",
  "processing",
  "analyzed",
  "extracted",
  "failed",
] as const;

export type SalesIntelSourceStatus =
  (typeof SALES_INTEL_SOURCE_STATUSES)[number];

/** A source only contributes driver-visible intelligence once extracted. */
export function sourceCanYieldDriverIntelligence(
  status: SalesIntelSourceStatus
): boolean {
  return status === "extracted";
}

/**
 * Framework review lifecycle. Acceptance happens inside the ingestion
 * pipeline — there is deliberately no separate "send to driver" step. Only
 * `accepted` frameworks are driver-visible.
 */
export const SALES_INTEL_REVIEW_STATES = [
  "review_required",
  "accepted",
  "rejected",
] as const;

export type SalesIntelReviewState = (typeof SALES_INTEL_REVIEW_STATES)[number];

/**
 * Extraction confidence at or above this bar is accepted automatically;
 * anything lower waits for a human. This keeps "no second sync step" true
 * without letting low-confidence extraction pose as trainer doctrine.
 */
export const SALES_INTEL_AUTO_ACCEPT_CONFIDENCE = 0.6;

export function reviewStateForExtraction(input: {
  confidence: number | null;
  sourceType: SalesIntelSourceType;
}): SalesIntelReviewState {
  if (isSyntheticSourceType(input.sourceType)) return "review_required";
  if (input.confidence === null) return "review_required";
  return input.confidence >= SALES_INTEL_AUTO_ACCEPT_CONFIDENCE
    ? "accepted"
    : "review_required";
}

export function isDriverVisibleReviewState(
  state: SalesIntelReviewState
): boolean {
  return state === "accepted";
}

/**
 * Distinguishes language genuinely present in the source from language the
 * extractor restated. A paraphrase is never promoted into a quote.
 */
export const SALES_INTEL_PHRASE_KINDS = [
  "exact_source_phrase",
  "paraphrased_principle",
] as const;

export type SalesIntelPhraseKind = (typeof SALES_INTEL_PHRASE_KINDS)[number];

export type SalesIntelPhrase = {
  kind: SalesIntelPhraseKind;
  text: string;
};

/** How analyzable content reached us. Caption-only is labelled, never implied. */
export const SALES_INTEL_CONTENT_KINDS = [
  "supplied_transcript",
  "video_understanding",
  "audio_transcription",
  "caption_only",
] as const;

export type SalesIntelContentKind = (typeof SALES_INTEL_CONTENT_KINDS)[number];

/** Immutable evidence of where intelligence came from. Never rewritten. */
export type SalesIntelSourceArtifact = {
  id: string;
  sourceType: SalesIntelSourceType;
  sourceUrl: string | null;
  canonicalUrl: string | null;
  externalContentId: string | null;
  creatorName: string | null;
  creatorHandle: string | null;
  publishedAt: string | null;
  title: string | null;
  contentHash: string;
  ingestedAt: string;
  ingestedBy: string;
  metadata: Record<string, unknown>;
  status: SalesIntelSourceStatus;
  failureCode: string | null;
  failureMessage: string | null;
  failureRetryable: boolean;
  attemptCount: number;
  lastAttemptAt: string | null;
};

export type SalesIntelTranscriptSegment = {
  startMs: number;
  endMs: number;
  text: string;
};

/**
 * A transcript or a model-derived video analysis. Versioned per source:
 * re-analysis creates version N+1 and never destroys version N.
 */
export type SalesIntelTranscript = {
  id: string;
  sourceArtifactId: string;
  contentKind: SalesIntelContentKind;
  text: string;
  segments: SalesIntelTranscriptSegment[];
  provider: string | null;
  model: string | null;
  analysisVersion: string | null;
  version: number;
  createdAt: string;
};

/**
 * A normalized framework: one trainer's teaching for one archetype on one
 * channel. Two trainers who disagree produce two rows — never an average.
 */
export type SalesIntelFramework = {
  id: string;
  sourceArtifactId: string;
  transcriptId: string | null;
  creatorName: string;
  creatorHandle: string | null;
  archetype: ObjectionArchetype;
  channel: SalesIntelChannel;
  exactObjection: string;
  diagnosis: string | null;
  frameworkName: string;
  principle: string;
  responseFamily: string;
  discoveryQuestions: string[];
  exampleLanguage: SalesIntelPhrase[];
  whenToUse: string[];
  whenNotToUse: string[];
  followUpMoves: string[];
  badResponses: string[];
  confidence: number | null;
  extractionVersion: string;
  extractionProvider: string | null;
  extractionModel: string | null;
  promptVersion: string | null;
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

// ---------------------------------------------------------------------------
// URL canonicalization
//
// Pure string work so the admin client and the server agree on identity.
// Canonicalization only narrows to an identity we can justify; when a URL
// cannot be resolved safely we return null rather than guess.
// ---------------------------------------------------------------------------

export type CanonicalSourceIdentity = {
  sourceType: SalesIntelSourceType;
  canonicalUrl: string;
  externalContentId: string | null;
  creatorHandle: string | null;
};

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Resolves watch?v=, youtu.be/, /shorts/, /embed/, and /live/ forms to one
 * canonical identity so URL formatting differences never create duplicate
 * logical sources.
 */
export function canonicalizeYouTubeUrl(
  raw: string
): CanonicalSourceIdentity | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www[.]/, "");
  const isYouTube =
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtube-nocookie.com" ||
    host === "youtu.be";
  if (!isYouTube) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  let videoId: string | null = null;

  if (host === "youtu.be") {
    videoId = segments[0] ?? null;
  } else if (segments[0] === "watch") {
    videoId = url.searchParams.get("v");
  } else if (
    segments[0] === "shorts" ||
    segments[0] === "embed" ||
    segments[0] === "live" ||
    segments[0] === "v"
  ) {
    videoId = segments[1] ?? null;
  }

  if (!videoId || !YOUTUBE_ID.test(videoId)) return null;

  return {
    sourceType: "youtube",
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    externalContentId: videoId,
    creatorHandle: null,
  };
}

const INSTAGRAM_SHORTCODE = /^[A-Za-z0-9_-]{5,32}$/;

/**
 * Resolves /reel/, /reels/, /p/, and /tv/ forms — with or without a creator
 * prefix — to one canonical Reel identity. When no shortcode can be read we
 * return null instead of inventing an identity.
 */
export function canonicalizeInstagramUrl(
  raw: string
): CanonicalSourceIdentity | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www[.]/, "");
  if (host !== "instagram.com" && host !== "m.instagram.com") return null;

  const segments = url.pathname.split("/").filter(Boolean);
  const kindIndex = segments.findIndex(
    segment =>
      segment === "reel" ||
      segment === "reels" ||
      segment === "p" ||
      segment === "tv"
  );
  if (kindIndex === -1) return null;

  const shortcode = segments[kindIndex + 1] ?? null;
  if (!shortcode || !INSTAGRAM_SHORTCODE.test(shortcode)) return null;

  // A path segment before the media kind is the creator handle.
  const handle = kindIndex > 0 ? (segments[kindIndex - 1] ?? null) : null;

  return {
    sourceType: "instagram",
    canonicalUrl: `https://www.instagram.com/reel/${shortcode}/`,
    externalContentId: shortcode,
    creatorHandle: handle ? `@${handle}` : null,
  };
}

/**
 * Classifies pasted admin input into a source identity. Returns null for free
 * text, which the caller treats as a supplied transcript.
 */
export function classifySalesIntelInput(
  raw: string
): CanonicalSourceIdentity | null {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return (
    canonicalizeYouTubeUrl(trimmed) ??
    canonicalizeInstagramUrl(trimmed) ?? {
      sourceType: "manual_url",
      canonicalUrl: trimmed,
      externalContentId: null,
      creatorHandle: null,
    }
  );
}

/**
 * Normalized identity inputs. Hashes are computed server-side so this module
 * stays free of node builtins.
 *
 * When a stable external identity exists it alone defines the source, so
 * attaching a transcript later does not fork into a second artifact.
 */
export function salesIntelContentIdentityParts(input: {
  sourceType: SalesIntelSourceType;
  canonicalUrl?: string | null;
  externalContentId?: string | null;
  transcriptText?: string | null;
}): string[] {
  const externalId = (input.externalContentId ?? "").trim();
  if (externalId) return [input.sourceType, externalId];
  const canonicalUrl = (input.canonicalUrl ?? "").trim().toLowerCase();
  if (canonicalUrl) return [input.sourceType, canonicalUrl];
  return [
    input.sourceType,
    (input.transcriptText ?? "").replace(/[\s]+/g, " ").trim().toLowerCase(),
  ];
}

/**
 * Identity of a framework *within* a source, so re-extraction supersedes the
 * previous version of the same teaching rather than duplicating it.
 */
export function salesIntelFrameworkIdentityParts(input: {
  sourceArtifactId: string;
  archetype: ObjectionArchetype;
  channel: SalesIntelChannel;
  frameworkName: string;
  exactObjection: string;
}): string[] {
  return [
    input.sourceArtifactId,
    input.archetype,
    input.channel,
    input.frameworkName.trim().toLowerCase(),
    input.exactObjection.trim().toLowerCase(),
  ];
}

// ---------------------------------------------------------------------------
// Import contract
//
// The documented shape a sourced-corpus researcher hands us. Validated at the
// boundary; researchers never touch the database.
// ---------------------------------------------------------------------------

const phraseSchema = z.union([
  z.string().trim().min(1).max(2_000),
  z.object({
    kind: z.enum(SALES_INTEL_PHRASE_KINDS),
    text: z.string().trim().min(1).max(2_000),
  }),
]);

export const salesIntelFrameworkImportSchema = z.object({
  archetype: z.enum(OBJECTION_ARCHETYPES),
  channel: z.enum(SALES_INTEL_CHANNELS),
  exactObjection: z.string().trim().min(1).max(1_000),
  diagnosis: z.string().trim().max(2_000).nullish(),
  frameworkName: z.string().trim().min(1).max(191),
  principle: z.string().trim().min(1).max(2_000),
  responseFamily: z.string().trim().min(1).max(191),
  discoveryQuestions: z
    .array(z.string().trim().min(1).max(1_000))
    .max(12)
    .default([]),
  exampleLanguage: z.array(phraseSchema).max(12).default([]),
  whenToUse: z.array(z.string().trim().min(1).max(1_000)).max(12).default([]),
  whenNotToUse: z
    .array(z.string().trim().min(1).max(1_000))
    .max(12)
    .default([]),
  followUpMoves: z
    .array(z.string().trim().min(1).max(1_000))
    .max(12)
    .default([]),
  badResponses: z
    .array(z.string().trim().min(1).max(1_000))
    .max(12)
    .default([]),
  confidence: z.number().min(0).max(1).nullish(),
  transcriptStartMs: z.number().int().min(0).nullish(),
  transcriptEndMs: z.number().int().min(0).nullish(),
});

export type SalesIntelFrameworkImport = z.infer<
  typeof salesIntelFrameworkImportSchema
>;

export const salesIntelImportSchema = z
  .object({
    creator: z.object({
      name: z.string().trim().min(1).max(191),
      handle: z.string().trim().max(191).nullish(),
    }),
    source: z.object({
      type: z.enum(SALES_INTEL_SOURCE_TYPES),
      url: z.string().trim().url().max(1_024).nullish(),
      externalId: z.string().trim().max(191).nullish(),
      publishedAt: z.string().trim().datetime().nullish(),
      title: z.string().trim().max(512).nullish(),
    }),
    transcript: z
      .object({
        text: z.string().trim().min(1),
        contentKind: z
          .enum(SALES_INTEL_CONTENT_KINDS)
          .default("supplied_transcript"),
        provider: z.string().trim().max(96).nullish(),
        model: z.string().trim().max(96).nullish(),
        segments: z
          .array(
            z.object({
              startMs: z.number().int().min(0),
              endMs: z.number().int().min(0),
              text: z.string().trim().min(1),
            })
          )
          .max(5_000)
          .default([]),
      })
      .nullish(),
    frameworks: z.array(salesIntelFrameworkImportSchema).max(200).default([]),
  })
  .superRefine((value, ctx) => {
    if (!value.source.url && !value.source.externalId && !value.transcript) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A source must be identifiable: supply source.url, source.externalId, or a transcript.",
        path: ["source"],
      });
    }
    for (let index = 0; index < value.frameworks.length; index += 1) {
      const framework = value.frameworks[index]!;
      const { transcriptStartMs, transcriptEndMs } = framework;
      if (
        typeof transcriptStartMs === "number" &&
        typeof transcriptEndMs === "number" &&
        transcriptEndMs < transcriptStartMs
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "transcriptEndMs must not precede transcriptStartMs",
          path: ["frameworks", index, "transcriptEndMs"],
        });
      }
    }
  });

export type SalesIntelImport = z.infer<typeof salesIntelImportSchema>;

/**
 * Example language supplied as a bare string is a paraphrase until a caller
 * explicitly asserts it is verbatim.
 */
export function normalizeImportedPhrase(
  value: string | SalesIntelPhrase
): SalesIntelPhrase {
  if (typeof value === "string") {
    return { kind: "paraphrased_principle", text: value };
  }
  return value;
}
