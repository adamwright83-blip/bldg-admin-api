/**
 * Re-extracts general sales teachings from a source's EXISTING, already-
 * persisted transcripts — never fetches content, never calls a video
 * provider (Gemini), never creates a second source artifact. Built for
 * exactly this situation: a source (e.g. Shelby Sapp's long-form video)
 * already has real, faithful transcript/analysis text sitting in
 * `sales_intel_transcripts`, and the only thing that needs to change is
 * which extractor reads it.
 *
 * Idempotent per transcript: a transcript already run through the CURRENT
 * extraction version is skipped, not reprocessed (see
 * salesIntelTeachingStore.transcriptAlreadyExtracted). A second identical
 * invocation therefore creates zero duplicate teachings.
 *
 * Distinguishes WHY a transcript produced no teachings (Step 17): a
 * transcript that genuinely taught nothing is `no_teachings`, never
 * conflated with `provider_unavailable`, `invalid_output`, or `failed`.
 */
import type { SalesIntelSourceArtifact, SalesIntelTranscript } from "../../shared/salesIntel";
import type { SalesIntelTeaching } from "../../shared/salesIntelTeaching";
import { salesIntelTeachingKey } from "./salesIntelIdentity";
import { salesIntelFrameworkKey } from "./salesIntelIdentity";
import {
  TeachingExtractionUnavailableError,
  TeachingExtractionValidationError,
  resolveSalesIntelTeachingExtractor,
  type SalesIntelTeachingExtractor,
} from "./salesIntelTeachingExtraction";
import {
  persistTeachingVersion,
  transcriptAlreadyExtracted,
} from "./salesIntelTeachingStore";
import {
  getSourceArtifact,
  listTranscripts,
  persistFrameworkVersion,
  setSourceStatus,
} from "./salesIntelStore";
import { reviewStateForExtraction, type SalesIntelSourceType } from "../../shared/salesIntel";

export type TranscriptExtractionStatus =
  | "persisted"
  | "no_teachings"
  | "provider_unavailable"
  | "invalid_output"
  | "failed"
  | "skipped_already_extracted";

export type TranscriptExtractionOutcome = {
  transcriptId: string;
  transcriptVersion: number;
  segmentStartMs: number | null;
  segmentEndMs: number | null;
  status: TranscriptExtractionStatus;
  teachingsCreated: number;
  objectionMappingsCreated: number;
  errorMessage: string | null;
};

export type TeachingReExtractionResult = {
  artifact: SalesIntelSourceArtifact;
  transcriptResults: TranscriptExtractionOutcome[];
  totalTeachingsCreated: number;
  totalObjectionMappingsCreated: number;
};

export async function reextractGeneralTeachingsFromTranscripts(input: {
  sourceArtifactId: string;
  actorId: string;
  extractor?: SalesIntelTeachingExtractor;
  forceReprocess?: boolean;
}): Promise<TeachingReExtractionResult> {
  const artifact = await getSourceArtifact(input.sourceArtifactId);
  if (!artifact) throw new Error("Sales Intel source not found");

  const extractor = input.extractor ?? resolveSalesIntelTeachingExtractor();
  const transcripts = await listTranscripts(input.sourceArtifactId);

  const transcriptResults: TranscriptExtractionOutcome[] = [];
  let totalTeachingsCreated = 0;
  let totalObjectionMappingsCreated = 0;

  for (const transcript of transcripts) {
    const segment = transcript.segments[0] ?? null;
    const baseResult = {
      transcriptId: transcript.id,
      transcriptVersion: transcript.version,
      segmentStartMs: segment?.startMs ?? null,
      segmentEndMs: segment?.endMs ?? null,
    };

    if (
      !input.forceReprocess &&
      (await transcriptAlreadyExtracted({
        transcriptId: transcript.id,
        extractionVersion: extractor.extractionVersion,
      }))
    ) {
      transcriptResults.push({
        ...baseResult,
        status: "skipped_already_extracted",
        teachingsCreated: 0,
        objectionMappingsCreated: 0,
        errorMessage: null,
      });
      continue;
    }

    let extraction;
    try {
      extraction = await extractor.extract({
        transcriptText: transcript.text,
        creatorName: artifact.creatorName ?? "Unattributed source",
        creatorHandle: artifact.creatorHandle,
        hasTimestamps: transcript.segments.length > 0,
      });
    } catch (error) {
      const status: TranscriptExtractionStatus =
        error instanceof TeachingExtractionUnavailableError
          ? "provider_unavailable"
          : error instanceof TeachingExtractionValidationError
            ? "invalid_output"
            : "failed";
      transcriptResults.push({
        ...baseResult,
        status,
        teachingsCreated: 0,
        objectionMappingsCreated: 0,
        errorMessage: error instanceof Error ? error.message : "Extraction failed",
      });
      continue;
    }

    if (extraction.teachings.length === 0) {
      transcriptResults.push({
        ...baseResult,
        status: "no_teachings",
        teachingsCreated: 0,
        objectionMappingsCreated: 0,
        errorMessage: null,
      });
      continue;
    }

    let teachingsCreated = 0;
    let objectionMappingsCreated = 0;
    for (const teaching of extraction.teachings) {
      const teachingKey = salesIntelTeachingKey({
        sourceArtifactId: artifact.id,
        transcriptId: transcript.id,
        category: teaching.category,
        title: teaching.title,
      });
      await persistTeachingVersion({
        teachingKey,
        sourceArtifactId: artifact.id,
        transcriptId: transcript.id,
        creatorName: artifact.creatorName ?? "Unattributed source",
        creatorHandle: artifact.creatorHandle,
        category: teaching.category,
        title: teaching.title,
        principle: teaching.principle,
        whenToUse: teaching.whenToUse,
        whenNotToUse: teaching.whenNotToUse,
        exampleLanguage: teaching.exampleLanguagePhrases,
        confidence: teaching.confidence,
        extractionVersion: extraction.extractionVersion,
        extractionProvider: extraction.provider,
        extractionModel: extraction.model,
        promptVersion: extraction.promptVersion,
        // Absolute (video-level) evidence range: the segment's own real
        // range, never a finer sub-segment guess.
        transcriptStartMs: segment?.startMs ?? null,
        transcriptEndMs: segment?.endMs ?? null,
        reviewState: reviewStateForExtraction({
          confidence: teaching.confidence,
          sourceType: artifact.sourceType as SalesIntelSourceType,
        }),
      });
      teachingsCreated += 1;

      // An objection mapping is a candidate for the EXISTING framework
      // pipeline — its own independent row, own independent review state.
      // Accepting the teaching never implies accepting this mapping, and
      // vice versa.
      if (teaching.objectionMapping) {
        const mapping = teaching.objectionMapping;
        const frameworkKey = salesIntelFrameworkKey({
          sourceArtifactId: artifact.id,
          archetype: mapping.archetype,
          channel: mapping.channel,
          frameworkName: mapping.frameworkName,
          exactObjection: mapping.exactObjection,
        });
        await persistFrameworkVersion({
          frameworkKey,
          sourceArtifactId: artifact.id,
          transcriptId: transcript.id,
          creatorName: artifact.creatorName ?? "Unattributed source",
          creatorHandle: artifact.creatorHandle,
          archetype: mapping.archetype,
          channel: mapping.channel,
          exactObjection: mapping.exactObjection,
          diagnosis: null,
          frameworkName: mapping.frameworkName,
          principle: teaching.principle,
          responseFamily: mapping.responseFamily,
          discoveryQuestions: mapping.discoveryQuestions,
          exampleLanguage: teaching.exampleLanguagePhrases,
          whenToUse: mapping.whenToUse,
          whenNotToUse: mapping.whenNotToUse,
          followUpMoves: mapping.followUpMoves,
          badResponses: mapping.badResponses,
          confidence: teaching.confidence,
          extractionVersion: extraction.extractionVersion,
          extractionProvider: extraction.provider,
          extractionModel: extraction.model,
          promptVersion: extraction.promptVersion,
          transcriptStartMs: segment?.startMs ?? null,
          transcriptEndMs: segment?.endMs ?? null,
          reviewState: reviewStateForExtraction({
            confidence: teaching.confidence,
            sourceType: artifact.sourceType as SalesIntelSourceType,
          }),
        });
        objectionMappingsCreated += 1;
      }
    }

    transcriptResults.push({
      ...baseResult,
      status: "persisted",
      teachingsCreated,
      objectionMappingsCreated,
      errorMessage: null,
    });
    totalTeachingsCreated += teachingsCreated;
    totalObjectionMappingsCreated += objectionMappingsCreated;
  }

  // The coarse source status only ever meant "objection frameworks were
  // extracted" — that contract is preserved exactly: only flip to
  // "extracted" when a real objection-framework mapping was actually
  // derived. A rich teaching corpus with no objection mapping is real
  // signal, and it stays visible in the teaching review queue/coverage —
  // it does not silently borrow the framework contract's status value.
  if (totalObjectionMappingsCreated > 0) {
    await setSourceStatus({ id: artifact.id, status: "extracted", countAttempt: true });
  } else if (totalTeachingsCreated > 0) {
    // Real content exists now — clear the stale "no_frameworks_found"
    // framing rather than leaving it looking like a dead end.
    await setSourceStatus({
      id: artifact.id,
      status: "analyzed",
      failureCode: null,
      failureMessage: null,
      failureRetryable: false,
      countAttempt: true,
    });
  }

  return {
    artifact: (await getSourceArtifact(artifact.id)) ?? artifact,
    transcriptResults,
    totalTeachingsCreated,
    totalObjectionMappingsCreated,
  };
}

export type { SalesIntelTeaching, SalesIntelTranscript };
