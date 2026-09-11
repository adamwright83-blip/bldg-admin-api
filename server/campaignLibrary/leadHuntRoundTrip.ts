/**
 * Slice 1 §1.3 round-trip: a campaign whose legacyContract is "lead_hunt"
 * must reconstruct into a LeadHuntDefinition that produces byte-identical
 * projectLeadHuntTargets output to the existing hardcoded definition it
 * replaces (COLOSSEUM_LEAD_HUNT). This is the regression test for Slice 1.
 */
import type { LeadHuntDefinition } from "../../shared/leadHunt";
import type { GrowthCampaign } from "./campaignLibraryTypes";

/**
 * The Greystar Koreatown lead hunt is real, sourced, and fixed — five
 * specific properties, chosen once. It is not reconstructable purely from
 * the generic campaign fields (objective/completion text can't encode a
 * villain target id or a target list), so the campaign carries a reference
 * to this table rather than the full definition. Adding a new lead-hunt
 * campaign means adding its definition here, exactly like adding a new
 * mission required a new LeadHuntDefinition before.
 */
const LEAD_HUNT_DEFINITIONS: Record<string, LeadHuntDefinition> = {
  "greystar-koreatown-five": {
    id: "greystar-koreatown-five",
    title: "THE GREYSTAR HUNT",
    targetCategory: "luxury_high_rise",
    targetIds: [
      "rise-koreatown",
      "avana-on-wilshire",
      "the-pearl-on-wilshire",
      "wilshire-vermont",
      "the-chadwick",
    ],
    requiredRealWorldAction: "pitch_in_person",
    completionCount: 5,
    villainTargetId: "the-chadwick",
    revealTreatment: "colosseum_target_located",
    fictionalReward: "boss_breach",
  },
};

export function leadHuntDefinitionForCampaign(
  campaign: Pick<GrowthCampaign, "legacyContract" | "legacyContractRef">
): LeadHuntDefinition | null {
  if (campaign.legacyContract !== "lead_hunt") return null;
  const leadHuntId = campaign.legacyContractRef?.leadHuntId;
  if (!leadHuntId) return null;
  return LEAD_HUNT_DEFINITIONS[leadHuntId] ?? null;
}
