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
  listFrameworksPendingReview,
} from "./salesIntelStore";
import { sourceCompletenessTier, type FrameworkQualitySignals } from "../../shared/salesIntelQuality";
import type { SalesIntelFramework } from "../../shared/salesIntel";

export type FrameworkReviewQueueEntry = {
  framework: SalesIntelFramework;
  quality: FrameworkQualitySignals;
};

export async function getFrameworkReviewQueue(): Promise<
  FrameworkReviewQueueEntry[]
> {
  const pending = await listFrameworksPendingReview();
  const entries: FrameworkReviewQueueEntry[] = [];
  for (const framework of pending) {
    const transcript = await getLatestTranscript(framework.sourceArtifactId);
    const independentSourceSupportCount = await countIndependentSourceSupport({
      frameworkId: framework.id,
      sourceArtifactId: framework.sourceArtifactId,
      archetype: framework.archetype,
      channel: framework.channel,
      responseFamily: framework.responseFamily,
    });
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
    });
  }
  return entries;
}
