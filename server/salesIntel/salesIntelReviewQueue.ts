/**
 * Assembles the admin review queue: every framework awaiting a human
 * decision, with explainable quality signals attached (Slice 41). No signal
 * here is a fabricated effectiveness score — each is a fact about the
 * evidence (how complete the source content was, how many independent
 * sources teach something similar, what the extractor's own confidence
 * was).
 */
import {
  countIndependentSourceSupport,
  getLatestTranscript,
  getSourceArtifact,
  listFrameworksPendingReview,
} from "./salesIntelStore";
import { sourceCompletenessTier, type FrameworkQualitySignals } from "../../shared/salesIntelQuality";
import type { SalesIntelFramework } from "../../shared/salesIntel";

export type FrameworkReviewQueueEntry = {
  framework: SalesIntelFramework;
  quality: FrameworkQualitySignals;
  /** So the reviewer can always reach the real source — no hidden provenance (Slice 48). */
  source: {
    canonicalUrl: string | null;
    title: string | null;
    publishedAt: string | null;
  };
};

export async function getFrameworkReviewQueue(): Promise<
  FrameworkReviewQueueEntry[]
> {
  const pending = await listFrameworksPendingReview();
  const entries: FrameworkReviewQueueEntry[] = [];
  for (const framework of pending) {
    const [transcript, sourceArtifact, independentSourceSupportCount] = await Promise.all([
      getLatestTranscript(framework.sourceArtifactId),
      getSourceArtifact(framework.sourceArtifactId),
      countIndependentSourceSupport({
        frameworkId: framework.id,
        sourceArtifactId: framework.sourceArtifactId,
        archetype: framework.archetype,
        channel: framework.channel,
        responseFamily: framework.responseFamily,
      }),
    ]);
    entries.push({
      framework,
      quality: {
        sourceCompleteness: sourceCompletenessTier(
          transcript?.contentKind ?? null,
          Boolean(transcript)
        ),
        independentSourceSupportCount,
        modelConfidence: framework.confidence,
      },
      source: {
        canonicalUrl: sourceArtifact?.canonicalUrl ?? sourceArtifact?.sourceUrl ?? null,
        title: sourceArtifact?.title ?? null,
        publishedAt: sourceArtifact?.publishedAt ?? null,
      },
    });
  }
  return entries;
}
