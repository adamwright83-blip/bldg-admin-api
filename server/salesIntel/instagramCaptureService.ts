import {
  canonicalizeInstagramUrl,
  type SalesIntelSourceArtifact,
} from "../../shared/salesIntel";
import { salesIntelContentHash } from "./salesIntelIdentity";
import {
  appendTranscript,
  getLatestTranscript,
  getSourceArtifact,
  setSourceStatus,
  upsertSourceArtifact,
} from "./salesIntelStore";
import { listTeachingsForSource } from "./salesIntelTeachingStore";
import {
  reextractGeneralTeachingsFromTranscripts,
  type TranscriptExtractionStatus,
} from "./salesIntelTeachingReExtraction";
import {
  InstagramMediaResolveFailedError,
  InstagramMediaResolverUnavailableError,
  resolveInstagramMediaResolver,
  type InstagramMediaResolver,
} from "./instagramMediaResolver";
import { GeminiUploadedMediaUnderstandingProvider } from "./geminiUploadedMediaUnderstanding";
import {
  VideoUnderstandingFailedError,
  VideoUnderstandingUnavailableError,
} from "./videoUnderstanding";

import { enqueueInstagramCaptureJob } from "./instagramCaptureJobStore";

export type InstagramCaptureReceipt = {
  artifactId: string;
  created: boolean;
  status: SalesIntelSourceArtifact["status"];
  processingScheduled: boolean;
  message: string;
};

export type InstagramCaptureStatus = {
  artifactId: string;
  status: SalesIntelSourceArtifact["status"];
  failureCode: string | null;
  failureMessage: string | null;
  failureRetryable: boolean;
  transcriptReady: boolean;
  teachingCount: number;
};

/**
 * Fast path used by the phone: save a durable, deduplicated source reference
 * first, then let media/transcription/extraction happen after the response.
 * A lost process can be retried by sharing the same Reel again or using retry;
 * the stable Instagram shortcode means neither action forks the source.
 */
export async function captureInstagramSalesIntelReference(input: {
  reelUrl: string;
  actorId: string;
}): Promise<{ artifact: SalesIntelSourceArtifact; created: boolean }> {
  const identity = canonicalizeInstagramUrl(input.reelUrl);
  if (!identity) throw new Error("That does not look like a valid Instagram Reel URL.");
  const contentHash = salesIntelContentHash({
    sourceType: identity.sourceType,
    canonicalUrl: identity.canonicalUrl,
    externalContentId: identity.externalContentId,
  });
  return upsertSourceArtifact({
    contentHash,
    sourceType: "instagram",
    sourceUrl: input.reelUrl.trim(),
    canonicalUrl: identity.canonicalUrl,
    externalContentId: identity.externalContentId,
    creatorName: null,
    creatorHandle: identity.creatorHandle,
    publishedAt: null,
    title: null,
    metadata: { captureMode: "driver_share" },
    ingestedBy: input.actorId,
    status: "awaiting_content",
  });
}

export async function scheduleInstagramSalesIntelProcessing(input: {
  sourceArtifactId: string;
  actorId: string;
}): Promise<boolean> {
  const { scheduled } = await enqueueInstagramCaptureJob(input);
  if (scheduled) {
    void import("./instagramCaptureJobRunner")
      .then(({ kickInstagramCaptureJobRunner }) => kickInstagramCaptureJobRunner())
      .catch(error => console.warn("[Sales Intel] durable Instagram worker wake failed", error));
  }
  return scheduled;
}

const EXTRACTION_FAILURE_STATUSES = new Set<TranscriptExtractionStatus>([
  "provider_unavailable",
  "invalid_output",
  "failed",
]);

async function extractTeachingsAndRecordOutcome(input: {
  sourceArtifactId: string;
  actorId: string;
}): Promise<void> {
  const result = await reextractGeneralTeachingsFromTranscripts(input);
  const extractionFailure = result.transcriptResults.find(row =>
    EXTRACTION_FAILURE_STATUSES.has(row.status)
  );
  if (!extractionFailure) return;

  const retryable = extractionFailure.status !== "invalid_output";
  await setSourceStatus({
    id: input.sourceArtifactId,
    status: "failed",
    failureCode: `teaching_extraction_${extractionFailure.status}`,
    failureMessage:
      extractionFailure.errorMessage ??
      `General teaching extraction failed: ${extractionFailure.status}`,
    failureRetryable: retryable,
    countAttempt: true,
  });
}

export async function processInstagramSalesIntelCapture(
  input: {
    sourceArtifactId: string;
    actorId: string;
  },
  dependencies: {
    mediaResolver?: InstagramMediaResolver;
    mediaAnalyzer?: GeminiUploadedMediaUnderstandingProvider;
  } = {}
): Promise<InstagramCaptureStatus> {
  const artifact = await getSourceArtifact(input.sourceArtifactId);
  if (!artifact || artifact.sourceType !== "instagram") {
    throw new Error("Instagram Sales Intel source not found");
  }

  // Once durable content exists, never download/re-upload the Reel again.
  // General teaching extraction is itself version-idempotent per transcript.
  const existingTranscript = await getLatestTranscript(artifact.id);
  if (existingTranscript) {
    await extractTeachingsAndRecordOutcome({
      sourceArtifactId: artifact.id,
      actorId: input.actorId,
    });
    return getInstagramCaptureStatus(artifact.id);
  }

  const resolver = dependencies.mediaResolver ?? resolveInstagramMediaResolver();
  if (!resolver.configured) {
    await setSourceStatus({
      id: artifact.id,
      status: "awaiting_content",
      failureCode: "instagram_media_resolver_unavailable",
      failureMessage:
        "Reel captured. Automatic media resolution is not configured yet.",
      failureRetryable: true,
      countAttempt: true,
    });
    return getInstagramCaptureStatus(artifact.id);
  }

  await setSourceStatus({
    id: artifact.id,
    status: "processing",
    failureCode: null,
    failureMessage: null,
    failureRetryable: false,
  });

  try {
    const media = await resolver.resolve(
      artifact.canonicalUrl ?? artifact.sourceUrl ?? ""
    );

    // Fill creator/title metadata only when the resolver actually knows it;
    // upsertSourceArtifact never rewrites already-known identity fields.
    if (media.creatorName || media.creatorHandle || media.title || media.publishedAt) {
      await upsertSourceArtifact({
        contentHash: artifact.contentHash,
        sourceType: artifact.sourceType,
        sourceUrl: artifact.sourceUrl,
        canonicalUrl: artifact.canonicalUrl,
        externalContentId: artifact.externalContentId,
        creatorName: media.creatorName,
        creatorHandle: media.creatorHandle,
        publishedAt: media.publishedAt,
        title: media.title,
        metadata: artifact.metadata,
        ingestedBy: artifact.ingestedBy,
        status: artifact.status,
      });
    }

    const analyzer =
      dependencies.mediaAnalyzer ?? new GeminiUploadedMediaUnderstandingProvider();
    const analysis = await analyzer.analyze({
      mediaUrl: media.mediaUrl,
      externalContentId: artifact.externalContentId ?? artifact.id,
      mimeType: media.mimeType,
    });
    await appendTranscript({
      sourceArtifactId: artifact.id,
      contentKind: "video_understanding",
      text: analysis.text,
      segments: analysis.segments,
      provider: analysis.provider,
      model: analysis.model,
      analysisVersion: analysis.analysisVersion,
    });
    await setSourceStatus({
      id: artifact.id,
      status: "analyzed",
      failureCode: null,
      failureMessage: null,
      failureRetryable: false,
      countAttempt: true,
    });

    // The broad teaching extractor added in PR #46 is the canonical path for
    // short-form captures. Optional objection mappings are created only when
    // the source evidence genuinely supports them.
    await extractTeachingsAndRecordOutcome({
      sourceArtifactId: artifact.id,
      actorId: input.actorId,
    });
  } catch (error) {
    if (
      error instanceof InstagramMediaResolverUnavailableError ||
      error instanceof VideoUnderstandingUnavailableError
    ) {
      await setSourceStatus({
        id: artifact.id,
        status: "awaiting_content",
        failureCode: error.code,
        failureMessage: error.message,
        failureRetryable: true,
        countAttempt: true,
      });
      return getInstagramCaptureStatus(artifact.id);
    }

    if (error instanceof VideoUnderstandingFailedError && error.code === "empty_analysis") {
      await setSourceStatus({
        id: artifact.id,
        status: "analyzed",
        failureCode: "no_sales_instruction",
        failureMessage: "The Reel was analyzed but contained no usable sales instruction.",
        failureRetryable: false,
        countAttempt: true,
      });
      return getInstagramCaptureStatus(artifact.id);
    }

    const code =
      error instanceof InstagramMediaResolveFailedError ||
      error instanceof VideoUnderstandingFailedError
        ? error.code
        : "instagram_capture_failed";
    const retryable =
      error instanceof InstagramMediaResolveFailedError ||
      error instanceof VideoUnderstandingFailedError
        ? error.retryable
        : true;
    const message = error instanceof Error ? error.message : "Instagram capture failed";
    await setSourceStatus({
      id: artifact.id,
      status: "failed",
      failureCode: code,
      failureMessage: message,
      failureRetryable: retryable,
      countAttempt: true,
    });
  }

  return getInstagramCaptureStatus(artifact.id);
}

export async function getInstagramCaptureStatus(
  sourceArtifactId: string
): Promise<InstagramCaptureStatus> {
  const artifact = await getSourceArtifact(sourceArtifactId);
  if (!artifact || artifact.sourceType !== "instagram") {
    throw new Error("Instagram Sales Intel source not found");
  }
  const [transcript, teachings] = await Promise.all([
    getLatestTranscript(artifact.id),
    listTeachingsForSource(artifact.id, { activeOnly: true }),
  ]);
  return {
    artifactId: artifact.id,
    status: artifact.status,
    failureCode: artifact.failureCode,
    failureMessage: artifact.failureMessage,
    failureRetryable: artifact.failureRetryable,
    transcriptReady: Boolean(transcript),
    teachingCount: teachings.length,
  };
}

export async function captureInstagramSalesIntel(input: {
  reelUrl: string;
  actorId: string;
}): Promise<InstagramCaptureReceipt> {
  const { artifact, created } = await captureInstagramSalesIntelReference(input);
  const processingScheduled = await scheduleInstagramSalesIntelProcessing({
    sourceArtifactId: artifact.id,
    actorId: input.actorId,
  });
  return {
    artifactId: artifact.id,
    created,
    status: artifact.status,
    processingScheduled,
    message: created
      ? "Captured. You can keep scrolling."
      : "Already captured. Processing will resume without creating a duplicate.",
  };
}
