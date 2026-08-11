import type { SalesIntelContentKind } from "./salesIntel";

/**
 * Explainable, non-fabricated quality signals for a framework under review
 * (Slice 41). These describe the EVIDENCE quality, not creator quality or
 * effectiveness — there is deliberately no global win rate or "% effective"
 * number anywhere in this module.
 */

export const SOURCE_COMPLETENESS_TIERS = [
  "full_transcript",
  "partial_transcript",
  "caption_only",
  "url_reference_only",
] as const;
export type SourceCompletenessTier = (typeof SOURCE_COMPLETENESS_TIERS)[number];

const COMPLETENESS_LABEL: Record<SourceCompletenessTier, string> = {
  full_transcript: "Full transcript",
  partial_transcript: "Partial transcript",
  caption_only: "Caption only",
  url_reference_only: "URL reference only",
};

export function sourceCompletenessLabel(tier: SourceCompletenessTier): string {
  return COMPLETENESS_LABEL[tier];
}

/**
 * How much of the source's actual content backed this extraction. A
 * supplied/model-analyzed transcript is the strongest evidence; a
 * caption-only pass is weaker; no transcript at all means the framework
 * exists only as a URL reference (should not normally reach review).
 */
export function sourceCompletenessTier(
  contentKind: SalesIntelContentKind | null,
  hasTranscript: boolean
): SourceCompletenessTier {
  if (!hasTranscript || !contentKind) return "url_reference_only";
  if (contentKind === "caption_only") return "caption_only";
  if (contentKind === "supplied_transcript" || contentKind === "video_understanding") {
    return "full_transcript";
  }
  return "partial_transcript";
}

export type FrameworkQualitySignals = {
  sourceCompleteness: SourceCompletenessTier;
  /** Count of OTHER distinct creators teaching a similar response for this archetype/channel. Never causal. */
  independentSourceSupportCount: number;
  modelConfidence: number | null;
};

/**
 * Plain-language, fact-only summary for the review UI. Never produces a
 * percentage-effectiveness claim — only describes what evidence exists.
 */
export function describeFrameworkQuality(signals: FrameworkQualitySignals): string {
  const parts = [sourceCompletenessLabel(signals.sourceCompleteness)];
  if (signals.independentSourceSupportCount > 0) {
    parts.push(
      `${signals.independentSourceSupportCount} other source${signals.independentSourceSupportCount === 1 ? "" : "s"} teach a similar response`
    );
  }
  if (signals.modelConfidence != null) {
    parts.push(`extraction confidence ${Math.round(signals.modelConfidence * 100)}%`);
  }
  return parts.join(" · ");
}
