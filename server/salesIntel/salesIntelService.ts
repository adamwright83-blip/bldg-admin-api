/**
 * Sales Intel orchestration.
 *
 * One pipeline serves all three input modes:
 *
 *   SOURCE -> TRANSCRIPT/ANALYSIS -> EXTRACTION -> FRAMEWORK -> ARMORY
 *
 * Acceptance happens inside this pipeline. There is deliberately no
 * "send to driver" step: the game queries the same authoritative Armory
 * backend, so an accepted framework is immediately eligible.
 *
 * Failure never destroys provenance. A source whose content cannot be obtained
 * rests in `awaiting_content`; a source whose analysis or extraction failed
 * rests in `failed` with the reason recorded. Neither state fabricates
 * intelligence, and neither is visible to the driver.
 */
import {
  classifySalesIntelInput,
  reviewStateForExtraction,
  type SalesIntelFramework,
  type SalesIntelSourceArtifact,
  type SalesIntelSourceType,
  type SalesIntelTranscript,
  type SalesIntelTranscriptSegment,
} from "../../shared/salesIntel";
import { salesIntelContentHash, salesIntelFrameworkKey } from "./salesIntelIdentity";
import {
  ExtractionUnavailableError,
  ExtractionValidationError,
  resolveSalesIntelExtractor,
  type SalesIntelExtractor,
} from "./salesIntelExtraction";
import {
  appendTranscript,
  findSourceArtifactByHash,
  getLatestTranscript,
  getSourceArtifact,
  listFrameworksForSource,
  persistFrameworkVersion,
  setSourceStatus,
  upsertSourceArtifact,
} from "./salesIntelStore";
import {
  createSalesIntelAdapterRegistry,
  type SalesIntelAdapterRegistry,
  type SalesIntelSourceRequest,
} from "./sourceAdapters";

/** Used when no creator was supplied. Never guesses a real trainer's name. */
export const UNATTRIBUTED_CREATOR = "Unattributed source";

export type SalesIntelIngestionResult = {
  artifact: SalesIntelSourceArtifact;
  transcript: SalesIntelTranscript | null;
  frameworks: SalesIntelFramework[];
  /** What the operator should be told, in the admin UI's own words. */
  outcome:
    | "extracted"
    | "awaiting_content"
    | "failed"
    | "no_frameworks_found"
    | "duplicate_source";
  message: string;
};

export type SalesIntelDependencies = {
  adapters?: SalesIntelAdapterRegistry;
  extractor?: SalesIntelExtractor;
};

export type IngestSalesIntelInput = SalesIntelSourceRequest & {
  actorId: string;
};

/**
 * Entry point for `+ ADD SALES INTEL`. Accepts a YouTube URL, an Instagram
 * Reel URL, or pasted transcript text, and drives the whole pipeline.
 */
export async function ingestSalesIntelSource(
  input: IngestSalesIntelInput,
  dependencies: SalesIntelDependencies = {}
): Promise<SalesIntelIngestionResult> {
  const adapters = dependencies.adapters ?? createSalesIntelAdapterRegistry();

  // Resolve identity from the URL first so a duplicate paste short-circuits
  // before any paid provider call. Re-processing an already-extracted source
  // is an explicit action (`reextractSalesIntelSource`), never a side effect
  // of pasting the same link twice.
  const duplicate = await findExtractedDuplicate(input);
  if (duplicate) {
    return {
      artifact: duplicate,
      transcript: await getLatestTranscript(duplicate.id),
      frameworks: await listFrameworksForSource(duplicate.id, {
        activeOnly: true,
      }),
      outcome: "duplicate_source",
      message: "This source has already been ingested and extracted.",
    };
  }

  const adapter = adapters.resolveAdapter(input);
  const draft = await adapter.resolve(input);

  const contentHash = salesIntelContentHash({
    sourceType: draft.sourceType,
    canonicalUrl: draft.canonicalUrl,
    externalContentId: draft.externalContentId,
    transcriptText: draft.content?.text ?? null,
  });

  const { artifact, created } = await upsertSourceArtifact({
    contentHash,
    sourceType: draft.sourceType,
    sourceUrl: draft.sourceUrl,
    canonicalUrl: draft.canonicalUrl,
    externalContentId: draft.externalContentId,
    creatorName: draft.creatorName,
    creatorHandle: draft.creatorHandle,
    publishedAt: draft.publishedAt,
    title: draft.title,
    metadata: draft.metadata,
    ingestedBy: input.actorId,
    status: draft.content ? "processing" : "awaiting_content",
  });

  // Safety net for inputs whose identity only becomes knowable after the
  // adapter has run (pasted transcript text).
  if (!created && artifact.status === "extracted") {
    return {
      artifact,
      transcript: await getLatestTranscript(artifact.id),
      frameworks: await listFrameworksForSource(artifact.id, {
        activeOnly: true,
      }),
      outcome: "duplicate_source",
      message: "This source has already been ingested and extracted.",
    };
  }

  if (!draft.content) {
    await setSourceStatus({
      id: artifact.id,
      status: "awaiting_content",
      failureCode: draft.awaitingReason?.code ?? "content_required",
      failureMessage: draft.awaitingReason?.message ?? null,
      failureRetryable: draft.awaitingReason?.retryable ?? true,
      countAttempt: true,
    });
    const refreshed = (await getSourceArtifact(artifact.id)) ?? artifact;
    return {
      artifact: refreshed,
      transcript: null,
      frameworks: [],
      outcome: "awaiting_content",
      message:
        draft.awaitingReason?.message ??
        "The source was saved. Add a transcript or authorized media to extract it.",
    };
  }

  const transcript = await appendTranscript({
    sourceArtifactId: artifact.id,
    contentKind: draft.content.kind,
    text: draft.content.text,
    segments: draft.content.segments,
    provider: draft.content.provider,
    model: draft.content.model,
    analysisVersion: draft.content.analysisVersion,
  });
  await setSourceStatus({ id: artifact.id, status: "analyzed" });

  return runExtraction({
    artifact,
    transcript,
    actorId: input.actorId,
    creatorNameOverride: input.creatorName ?? null,
    extractor: dependencies.extractor,
  });
}

/**
 * Cheap pre-check for URL inputs: if this canonical source already reached
 * `extracted`, say so without invoking any provider. Returns null when the
 * operator supplied fresh content, since that is a deliberate re-analysis.
 */
async function findExtractedDuplicate(
  input: IngestSalesIntelInput
): Promise<SalesIntelSourceArtifact | null> {
  if (input.transcriptText?.trim()) return null;
  const identity = classifySalesIntelInput(input.input);
  if (!identity) return null;
  const existing = await findSourceArtifactByHash(
    salesIntelContentHash({
      sourceType: identity.sourceType,
      canonicalUrl: identity.canonicalUrl,
      externalContentId: identity.externalContentId,
    })
  );
  return existing?.status === "extracted" ? existing : null;
}

/**
 * Attaches operator-supplied content to a source that was waiting for it —
 * the Instagram path once a transcript exists — and runs extraction.
 */
export async function attachSalesIntelContent(
  input: {
    sourceArtifactId: string;
    actorId: string;
    transcriptText: string;
    segments?: SalesIntelTranscriptSegment[];
    contentKind?: "supplied_transcript" | "caption_only";
    creatorName?: string | null;
  },
  dependencies: SalesIntelDependencies = {}
): Promise<SalesIntelIngestionResult> {
  const artifact = await getSourceArtifact(input.sourceArtifactId);
  if (!artifact) throw new Error("Sales Intel source not found");

  const text = input.transcriptText.trim();
  if (!text) throw new Error("Supplied content cannot be empty");

  const transcript = await appendTranscript({
    sourceArtifactId: artifact.id,
    contentKind: input.contentKind ?? "supplied_transcript",
    text,
    segments: input.segments ?? [],
    provider: null,
    model: null,
    analysisVersion: null,
  });
  await setSourceStatus({ id: artifact.id, status: "analyzed" });

  return runExtraction({
    artifact,
    transcript,
    actorId: input.actorId,
    creatorNameOverride: input.creatorName ?? null,
    extractor: dependencies.extractor,
  });
}

/**
 * Re-extracts an existing source with the current extractor. Produces new
 * framework versions; prior versions are superseded, never deleted.
 */
export async function reextractSalesIntelSource(
  input: { sourceArtifactId: string; actorId: string },
  dependencies: SalesIntelDependencies = {}
): Promise<SalesIntelIngestionResult> {
  const artifact = await getSourceArtifact(input.sourceArtifactId);
  if (!artifact) throw new Error("Sales Intel source not found");
  const transcript = await getLatestTranscript(artifact.id);
  if (!transcript) {
    throw new Error(
      "This source has no transcript yet, so it cannot be re-extracted."
    );
  }
  return runExtraction({
    artifact,
    transcript,
    actorId: input.actorId,
    creatorNameOverride: null,
    extractor: dependencies.extractor,
  });
}

export type ExtractAndPersistResult =
  | { ok: true; frameworks: SalesIntelFramework[] }
  | { ok: false; code: string; message: string; retryable: boolean };

/**
 * The extraction-and-persist core, with no source-status side effects —
 * callers that process a source in one shot (`runExtraction` below) set
 * status once around this; callers processing a source across many
 * transcripts (long-form video segmentation) call this once per segment
 * transcript and decide status themselves after all segments finish, so
 * the source never reports "extracted" while segments are still pending.
 */
export async function extractAndPersistFrameworks(input: {
  artifact: SalesIntelSourceArtifact;
  transcript: SalesIntelTranscript;
  creatorNameOverride: string | null;
  extractor?: SalesIntelExtractor;
}): Promise<ExtractAndPersistResult> {
  const extractor = input.extractor ?? resolveSalesIntelExtractor();
  const creatorName =
    input.creatorNameOverride?.trim() ||
    input.artifact.creatorName ||
    UNATTRIBUTED_CREATOR;

  let extraction;
  try {
    extraction = await extractor.extract({
      transcriptText: input.transcript.text,
      creatorName,
      creatorHandle: input.artifact.creatorHandle,
      hasTimestamps: input.transcript.segments.length > 0,
    });
  } catch (error) {
    const retryable =
      error instanceof ExtractionUnavailableError
        ? error.retryable
        : error instanceof ExtractionValidationError
          ? error.retryable
          : true;
    const code =
      error instanceof ExtractionUnavailableError ||
      error instanceof ExtractionValidationError
        ? error.code
        : "extraction_failed";
    return {
      ok: false,
      code,
      message: error instanceof Error ? error.message : "Extraction failed",
      retryable,
    };
  }

  const persisted: SalesIntelFramework[] = [];
  for (const framework of extraction.frameworks) {
    const frameworkKey = salesIntelFrameworkKey({
      sourceArtifactId: input.artifact.id,
      archetype: framework.archetype,
      channel: framework.channel,
      frameworkName: framework.frameworkName,
      exactObjection: framework.exactObjection,
    });
    persisted.push(
      await persistFrameworkVersion({
        frameworkKey,
        sourceArtifactId: input.artifact.id,
        transcriptId: input.transcript.id,
        creatorName,
        creatorHandle: input.artifact.creatorHandle,
        archetype: framework.archetype,
        channel: framework.channel,
        exactObjection: framework.exactObjection,
        diagnosis: framework.diagnosis ?? null,
        frameworkName: framework.frameworkName,
        principle: framework.principle,
        responseFamily: framework.responseFamily,
        discoveryQuestions: framework.discoveryQuestions,
        exampleLanguage: framework.exampleLanguagePhrases,
        whenToUse: framework.whenToUse,
        whenNotToUse: framework.whenNotToUse,
        followUpMoves: framework.followUpMoves,
        badResponses: framework.badResponses,
        confidence: framework.confidence ?? null,
        extractionVersion: extraction.extractionVersion,
        extractionProvider: extraction.provider,
        extractionModel: extraction.model,
        promptVersion: extraction.promptVersion,
        transcriptStartMs: framework.transcriptStartMs ?? null,
        transcriptEndMs: framework.transcriptEndMs ?? null,
        reviewState: reviewStateForExtraction({
          confidence: framework.confidence ?? null,
          sourceType: input.artifact.sourceType as SalesIntelSourceType,
        }),
      })
    );
  }

  return { ok: true, frameworks: persisted };
}

async function runExtraction(input: {
  artifact: SalesIntelSourceArtifact;
  transcript: SalesIntelTranscript;
  actorId: string;
  creatorNameOverride: string | null;
  extractor?: SalesIntelExtractor;
}): Promise<SalesIntelIngestionResult> {
  const result = await extractAndPersistFrameworks(input);

  if (!result.ok) {
    await setSourceStatus({
      id: input.artifact.id,
      status: "failed",
      failureCode: result.code,
      failureMessage: result.message,
      failureRetryable: result.retryable,
      countAttempt: true,
    });
    const refreshed =
      (await getSourceArtifact(input.artifact.id)) ?? input.artifact;
    return {
      artifact: refreshed,
      transcript: input.transcript,
      frameworks: [],
      outcome: "failed",
      message: result.message,
    };
  }

  const persisted = result.frameworks;

  // A transcript that teaches nothing is a truthful outcome, not a failure —
  // but it must not leave the source claiming extracted intelligence.
  if (persisted.length === 0) {
    await setSourceStatus({
      id: input.artifact.id,
      status: "analyzed",
      failureCode: "no_frameworks_found",
      failureMessage:
        "The content was analyzed but taught no extractable objection handling.",
      failureRetryable: false,
      countAttempt: true,
    });
    const refreshed =
      (await getSourceArtifact(input.artifact.id)) ?? input.artifact;
    return {
      artifact: refreshed,
      transcript: input.transcript,
      frameworks: [],
      outcome: "no_frameworks_found",
      message:
        "Analyzed, but no objection-handling framework was found in this source.",
    };
  }

  await setSourceStatus({
    id: input.artifact.id,
    status: "extracted",
    countAttempt: true,
  });
  const refreshed =
    (await getSourceArtifact(input.artifact.id)) ?? input.artifact;

  const accepted = persisted.filter(
    framework => framework.reviewState === "accepted"
  ).length;
  return {
    artifact: refreshed,
    transcript: input.transcript,
    frameworks: persisted,
    outcome: "extracted",
    message:
      accepted === persisted.length
        ? `${persisted.length} framework${persisted.length === 1 ? "" : "s"} extracted and available to the Armory.`
        : `${persisted.length} framework${persisted.length === 1 ? "" : "s"} extracted; ${persisted.length - accepted} held for review.`,
  };
}
