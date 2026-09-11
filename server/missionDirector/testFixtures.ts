import type { GrowthCampaign } from "../campaignLibrary/campaignLibraryTypes";

export function buildCampaign(overrides: Partial<GrowthCampaign> & { campaignId: string }): GrowthCampaign {
  return {
    id: overrides.campaignId,
    tenantId: "default",
    enabled: true,
    title: overrides.campaignId,
    objective: "Test objective",
    completionCondition: "Test completion",
    prepLeadDays: 0,
    prepCondition: null,
    pocketKind: "any",
    pocketMinutesMin: 10,
    fallbackVariant: null,
    autoVerifiable: [],
    selfReported: [],
    missionCategory: "account_acquisition",
    companionAbilityId: null,
    timingAssumptions: [],
    opsTaskType: "manual_operator_task",
    legacyContract: null,
    legacyContractRef: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}
