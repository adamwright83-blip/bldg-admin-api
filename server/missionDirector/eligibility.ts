/**
 * Slice 4 §6 — deterministic campaign eligibility for a target business date.
 * Never touched by the model — see §5's determinism invariant.
 */
import type { GrowthCampaign } from "../campaignLibrary/campaignLibraryTypes";
import type { CampaignRejection } from "./missionDirectorTypes";

export function eligibleCampaigns(input: {
  campaigns: readonly GrowthCampaign[];
  /** campaignId -> whether prep evidence exists in time for the target date. */
  prepReady: Record<string, boolean>;
}): { eligible: GrowthCampaign[]; rejected: CampaignRejection[] } {
  const eligible: GrowthCampaign[] = [];
  const rejected: CampaignRejection[] = [];
  for (const campaign of input.campaigns) {
    if (!campaign.enabled) {
      rejected.push({
        campaignId: campaign.campaignId,
        reason: "DISABLED",
        detail: "Campaign is disabled in the library.",
      });
      continue;
    }
    if (campaign.prepLeadDays > 0 && !input.prepReady[campaign.campaignId]) {
      rejected.push({
        campaignId: campaign.campaignId,
        reason: "PREP_NOT_READY",
        detail: `Requires ${campaign.prepLeadDays} day(s) of prep (${campaign.prepCondition ?? "unspecified"}) not yet recorded.`,
      });
      continue;
    }
    eligible.push(campaign);
  }
  // Deterministic order: campaignId, never anything the model influences.
  eligible.sort((a, b) => a.campaignId.localeCompare(b.campaignId));
  return { eligible, rejected };
}
