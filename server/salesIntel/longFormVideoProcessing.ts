/**
 * Long-form video ingestion (Sales Intel).
 *
 * A monolithic single-request analysis of a long video is fragile: it risks
 * timeout, output-token limits, and losing an hour+ of work to one transient
 * failure. This module processes a video as deterministic time-based
 * segments instead — each segment becomes its own versioned row on the
 * SAME `salesIntelTranscripts` table the rest of Sales Intel already uses
 * (no migration needed: that table is already "versioned per source"),
 * with the segment's absolute video-time range recorded in its
 * `segmentsJson`. Extraction runs per segment, and candidates aggregate at
 * the source level — there remains exactly ONE logical source artifact for
 * the whole video.
 *
 * Sequential by design (Step 11): reliability and provenance matter more
 * than shaving a few minutes off first ingestion, and Gemini rate limits
 * for a preview feature (YouTube URL input) are not something to test by
 * firing eight requests at once.
 */
import type {
  SalesIntelFramework,
  SalesIntelSourceArtifact,
  SalesIntelTranscript,
} from "../../shared/salesIntel";
import {
  computeVideoSegments,
  type VideoSegment,
} from "../../shared/salesIntelLongFormVideo";
import type { SalesIntelExtractor } from "./salesIntelExtraction";
import { extractAndPersistFrameworks } from "./salesIntelService";
import {
  appendTranscript,
  getSourceArtifact,
  listTranscripts,
  setSourceStatus,
} from "./salesIntelStore";
import {
  VideoUnderstandingFailedError,
  VideoUnderstandingUnavailableError,
  resolveVideoUnderstandingProvider,
  type VideoUnderstandingProvider,
} from "./videoUnderstanding";

export const DEFAULT_LONG_FORM_CHUNK_SECONDS = 15 * 60;

export type SegmentOutcome = "completed" | "failed";

export type SegmentResult = {
  index: number;
  startSeconds: number;
  endSeconds: number;
  status: SegmentOutcome;
  /** Null when this segment's clip taught nothing (a real, expected outcome — not every minute of a 2-hour video is instructional). */
  transcriptId: string | null;
  /** True only when the provider actually ran for this segment — a resumed/skipped segment is still "completed" but did no new work. */
  wasReused: boolean;
  elapsedMs: number | null;
  provider: string | null;
  model: string | null;
  failureCode: string | null;
  failureMessage: string | null;
};

export type LongFormVideoIngestionResult = {
  artifact: SalesIntelSourceArtifact;
  segments: SegmentResult[];
  frameworks: SalesIntelFramework[];
  outcome: "completed" | "partial_failure" | "no_frameworks_found" | "provider_unavailable";
  message: string;
};

/**
 * A segment's identity is its absolute (video-level) time range on this
 * exact source artifact, among transcripts this same segmentation process
 * produced (`contentKind: "video_understanding"`, exactly one segment
 * record) — a retry landing on the same range must never reprocess it.
 * Deliberate re-analysis (a new provider/prompt version) is the explicit
 * `forceReprocess` flag, never an accidental skip of stale data.
 */
function findExistingSegmentTranscript(
  transcripts: SalesIntelTranscript[],
  segment: VideoSegment
): SalesIntelTranscript | null {
  const startMs = Math.round(segment.startSeconds * 1000);
  const endMs = Math.round(segment.endSeconds * 1000);
  return (
    transcripts.find(
      transcript =>
        transcript.contentKind === "video_understanding" &&
        transcript.segments.length === 1 &&
        transcript.segments[0].startMs === startMs &&
        transcript.segments[0].endMs === endMs
    ) ?? null
  );
}

export async function processLongFormVideoSegments(input: {
  sourceArtifactId: string;
  durationSeconds: number;
  actorId: string;
  chunkSeconds?: number;
  creatorNameOverride?: string | null;
  provider?: VideoUnderstandingProvider;
  extractor?: SalesIntelExtractor;
  /** Re-run every segment even if a matching transcript already exists. Off by default — resuming should never redo completed work. */
  forceReprocess?: boolean;
  onSegmentComplete?: (result: SegmentResult) => void;
}): Promise<LongFormVideoIngestionResult> {
  const artifact = await getSourceArtifact(input.sourceArtifactId);
  if (!artifact) throw new Error("Sales Intel source not found");

  const provider = input.provider ?? resolveVideoUnderstandingProvider();
  if (!provider.configured) {
    await setSourceStatus({
      id: artifact.id,
      status: "awaiting_content",
      failureCode: "provider_unavailable",
      failureMessage:
        "No video-understanding provider is configured. Supply a transcript for this source instead.",
      failureRetryable: true,
      countAttempt: true,
    });
    return {
      artifact: (await getSourceArtifact(artifact.id)) ?? artifact,
      segments: [],
      frameworks: [],
      outcome: "provider_unavailable",
      message: "No video-understanding provider is configured.",
    };
  }

  const chunkSeconds = input.chunkSeconds ?? DEFAULT_LONG_FORM_CHUNK_SECONDS;
  const plan = computeVideoSegments(input.durationSeconds, chunkSeconds);

  await setSourceStatus({ id: artifact.id, status: "processing" });

  const segmentResults: SegmentResult[] = [];
  const completedTranscripts: SalesIntelTranscript[] = [];

  for (const segment of plan) {
    const existingTranscripts = await listTranscripts(artifact.id);
    const existing = input.forceReprocess
      ? null
      : findExistingSegmentTranscript(existingTranscripts, segment);

    if (existing) {
      segmentResults.push({
        index: segment.index,
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds,
        status: "completed",
        transcriptId: existing.id,
        wasReused: true,
        elapsedMs: null,
        provider: existing.provider,
        model: existing.model,
        failureCode: null,
        failureMessage: null,
      });
      completedTranscripts.push(existing);
      input.onSegmentComplete?.(segmentResults.at(-1)!);
      continue;
    }

    const startedAt = Date.now();
    try {
      const analysis = await provider.analyze({
        canonicalUrl: artifact.canonicalUrl ?? artifact.sourceUrl ?? "",
        externalContentId: artifact.externalContentId,
        clip: {
          startOffsetSeconds: segment.startSeconds,
          endOffsetSeconds: segment.endSeconds,
        },
        mediaResolution: "low",
      });
      const transcript = await appendTranscript({
        sourceArtifactId: artifact.id,
        contentKind: "video_understanding",
        text: analysis.text,
        segments: [
          {
            startMs: Math.round(segment.startSeconds * 1000),
            endMs: Math.round(segment.endSeconds * 1000),
            text: analysis.text,
          },
        ],
        provider: analysis.provider,
        model: analysis.model,
        analysisVersion: analysis.analysisVersion,
      });
      completedTranscripts.push(transcript);
      segmentResults.push({
        index: segment.index,
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds,
        status: "completed",
        transcriptId: transcript.id,
        wasReused: false,
        elapsedMs: Date.now() - startedAt,
        provider: analysis.provider,
        model: analysis.model,
        failureCode: null,
        failureMessage: null,
      });
      input.onSegmentComplete?.(segmentResults.at(-1)!);
    } catch (error) {
      // A clip that genuinely teaches nothing (NO_SALES_INSTRUCTION) is a
      // real, expected outcome for a two-hour video — not every segment is
      // instructional. It's "completed" work, not a failure to retry.
      const isEmptyAnalysis =
        error instanceof VideoUnderstandingFailedError && error.code === "empty_analysis";
      if (isEmptyAnalysis) {
        segmentResults.push({
          index: segment.index,
          startSeconds: segment.startSeconds,
          endSeconds: segment.endSeconds,
          status: "completed",
          transcriptId: null,
          wasReused: false,
          elapsedMs: Date.now() - startedAt,
          provider: provider.key,
          model: null,
          failureCode: null,
          failureMessage: null,
        });
        input.onSegmentComplete?.(segmentResults.at(-1)!);
        continue;
      }

      const code =
        error instanceof VideoUnderstandingFailedError
          ? error.code
          : error instanceof VideoUnderstandingUnavailableError
            ? error.code
            : "long_form_segment_failed";
      const message = error instanceof Error ? error.message : "Segment analysis failed";
      segmentResults.push({
        index: segment.index,
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds,
        status: "failed",
        transcriptId: null,
        wasReused: false,
        elapsedMs: Date.now() - startedAt,
        provider: provider.key,
        model: null,
        failureCode: code,
        failureMessage: message,
      });
      input.onSegmentComplete?.(segmentResults.at(-1)!);

      // Stop rather than hammer the provider with the remaining segments —
      // a second invocation resumes from here (completed segments are
      // skipped above) once the underlying issue is understood.
      await setSourceStatus({
        id: artifact.id,
        status: "failed",
        failureCode: code,
        failureMessage: `Segment ${segment.index} (${segment.startSeconds}s-${segment.endSeconds}s): ${message}`,
        failureRetryable: true,
        countAttempt: true,
      });
      return {
        artifact: (await getSourceArtifact(artifact.id)) ?? artifact,
        segments: segmentResults,
        frameworks: [],
        outcome: "partial_failure",
        message: `Segment ${segment.index} failed: ${message}`,
      };
    }
  }

  // Extraction per segment transcript, aggregated at the source level —
  // never one giant concatenated transcript sent through extraction.
  const frameworks: SalesIntelFramework[] = [];
  for (const transcript of completedTranscripts) {
    const result = await extractAndPersistFrameworks({
      artifact,
      transcript,
      creatorNameOverride: input.creatorNameOverride ?? null,
      extractor: input.extractor,
    });
    if (result.ok) frameworks.push(...result.frameworks);
    // An extraction failure on one segment's transcript doesn't erase the
    // other segments' real transcripts or frameworks — it's logged via the
    // segment's own transcript row remaining, and simply contributes zero
    // frameworks from that segment.
  }

  if (frameworks.length === 0) {
    await setSourceStatus({
      id: artifact.id,
      status: "analyzed",
      failureCode: "no_frameworks_found",
      failureMessage:
        "The video was fully analyzed but taught no extractable objection handling.",
      failureRetryable: false,
      countAttempt: true,
    });
    return {
      artifact: (await getSourceArtifact(artifact.id)) ?? artifact,
      segments: segmentResults,
      frameworks: [],
      outcome: "no_frameworks_found",
      message: "Analyzed, but no objection-handling framework was found in this video.",
    };
  }

  await setSourceStatus({ id: artifact.id, status: "extracted", countAttempt: true });
  return {
    artifact: (await getSourceArtifact(artifact.id)) ?? artifact,
    segments: segmentResults,
    frameworks,
    outcome: "completed",
    message: `${segmentResults.length} segment(s) processed; ${frameworks.length} framework(s) extracted.`,
  };
}
