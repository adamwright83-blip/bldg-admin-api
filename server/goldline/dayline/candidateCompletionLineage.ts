import type { DayLineItemLineage } from "../../../shared/currentDayLine";
import type { WeeklyGrowthSourceRef } from "../../../shared/weeklyGrowthCandidates";

/**
 * Candidate lineage is a Planning projection, not a completion authority.
 * Resolve only source types that already have an authoritative Day Line
 * completion contract. Everything else must fail closed at the router.
 */
export function resolveCandidateCompletionLineage(
  sourceRefs: readonly WeeklyGrowthSourceRef[]
): DayLineItemLineage | null {
  const commitment = sourceRefs.find(
    ref => ref.sourceType === "day_director_commitment"
  );
  if (commitment) {
    return {
      kind: "commitment",
      sourceReference: `day_director_commitments:${commitment.sourceId}`,
      commitmentId: commitment.sourceId,
    };
  }

  const campaign = sourceRefs.find(
    ref => ref.sourceKind === "campaign_library"
  );
  if (campaign) {
    return {
      kind: "campaign",
      sourceReference: `campaign:${campaign.sourceId}`,
      campaignId: campaign.sourceId,
    };
  }

  return null;
}
