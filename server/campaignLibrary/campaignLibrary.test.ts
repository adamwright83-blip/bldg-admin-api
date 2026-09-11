import { describe, expect, it } from "vitest";
import { COLOSSEUM_LEAD_HUNT } from "../../client/src/pages/goldline/colosseumCampaign";
import { validateLeadHuntDefinition } from "../../shared/leadHunt";
import { leadHuntDefinitionForCampaign } from "./leadHuntRoundTrip";
import { SEED_CAMPAIGNS } from "./seedCampaigns";
import { POCKET_KINDS, MISSION_CATEGORIES } from "./campaignLibraryTypes";

describe("campaign library seeds", () => {
  it("has all seven business campaigns plus the Colosseum and Last Valet campaigns", () => {
    expect(SEED_CAMPAIGNS.length).toBe(9);
    const ids = SEED_CAMPAIGNS.map(seed => seed.campaignId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every seed populates the full Slice 4 field contract", () => {
    for (const { campaignId, campaign } of SEED_CAMPAIGNS) {
      expect(campaign.title.trim(), campaignId).not.toBe("");
      expect(campaign.objective.trim(), campaignId).not.toBe("");
      expect(campaign.completionCondition.trim(), campaignId).not.toBe("");
      expect(campaign.prepLeadDays, campaignId).toBeGreaterThanOrEqual(0);
      expect(POCKET_KINDS, campaignId).toContain(campaign.pocketKind);
      expect(campaign.pocketMinutesMin, campaignId).toBeGreaterThan(0);
      expect(Array.isArray(campaign.autoVerifiable), campaignId).toBe(true);
      expect(Array.isArray(campaign.selfReported), campaignId).toBe(true);
      expect(MISSION_CATEGORIES, campaignId).toContain(campaign.missionCategory);
      expect(Array.isArray(campaign.timingAssumptions), campaignId).toBe(true);
      expect(campaign.opsTaskType.trim(), campaignId).not.toBe("");
    }
  });

  it("round-trips the Colosseum campaign to a byte-identical LeadHuntDefinition", () => {
    const colosseumSeed = SEED_CAMPAIGNS.find(
      seed => seed.campaignId === "greystar-koreatown-colosseum"
    );
    expect(colosseumSeed).toBeDefined();
    const reconstructed = leadHuntDefinitionForCampaign({
      legacyContract: colosseumSeed!.campaign.legacyContract,
      legacyContractRef: colosseumSeed!.campaign.legacyContractRef,
    });
    expect(reconstructed).toEqual(COLOSSEUM_LEAD_HUNT);
    expect(validateLeadHuntDefinition(reconstructed!)).toEqual(
      COLOSSEUM_LEAD_HUNT
    );
  });

  it("returns null for a campaign with no legacy contract", () => {
    const doorHanger = SEED_CAMPAIGNS.find(
      seed => seed.campaignId === "door-hanger-territory-operation"
    )!;
    expect(
      leadHuntDefinitionForCampaign({
        legacyContract: doorHanger.campaign.legacyContract,
        legacyContractRef: doorHanger.campaign.legacyContractRef,
      })
    ).toBeNull();
  });
});
