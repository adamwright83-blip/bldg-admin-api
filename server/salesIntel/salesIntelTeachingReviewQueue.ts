/**
 * Assembles the admin review queue for general sales teachings — sibling to
 * salesIntelReviewQueue.ts (objection frameworks). Every entry carries real
 * source evidence (creator, source URL, title, segment timestamp) so a
 * reviewer never has to take a teaching's word for its own provenance.
 */
import { getSourceArtifact } from "./salesIntelStore";
import { listTeachingsPendingReview } from "./salesIntelTeachingStore";
import type { SalesIntelTeaching } from "../../shared/salesIntelTeaching";

export type TeachingReviewQueueEntry = {
  teaching: SalesIntelTeaching;
  source: {
    canonicalUrl: string | null;
    title: string | null;
    publishedAt: string | null;
  };
  /** True only when at least one example-language entry is a verbatim quote. */
  hasExactQuote: boolean;
};

export async function getTeachingReviewQueue(): Promise<TeachingReviewQueueEntry[]> {
  const pending = await listTeachingsPendingReview();
  const entries: TeachingReviewQueueEntry[] = [];
  for (const teaching of pending) {
    const sourceArtifact = await getSourceArtifact(teaching.sourceArtifactId);
    entries.push({
      teaching,
      source: {
        canonicalUrl: sourceArtifact?.canonicalUrl ?? sourceArtifact?.sourceUrl ?? null,
        title: sourceArtifact?.title ?? null,
        publishedAt: sourceArtifact?.publishedAt ?? null,
      },
      hasExactQuote: teaching.exampleLanguage.some(p => p.kind === "exact_source_phrase"),
    });
  }
  return entries;
}
