import {
  DEMO_MISSION,
  formatMissionCode,
  type CommercialMission,
  type CommercialOpportunity,
} from "./commercialMission";

export function buildCommercialMissionFromOpportunity(
  opportunity: CommercialOpportunity,
  input: {
    tenantId?: string;
    missionId?: number;
    accountAddress?: string;
    accountLat?: number;
    accountLng?: number;
  } = {}
): CommercialMission {
  const missionId = input.missionId ?? opportunity.id;
  const isCanonicalDemo = opportunity.id === DEMO_MISSION.accountId;

  return {
    ...DEMO_MISSION,
    id: missionId,
    code: isCanonicalDemo
      ? DEMO_MISSION.code
      : formatMissionCode(Math.abs(missionId) % 1000),
    tenantId: input.tenantId ?? DEMO_MISSION.tenantId,
    accountId: opportunity.id,
    accountName: opportunity.accountName,
    accountType: opportunity.accountType,
    accountAddress: input.accountAddress ?? DEMO_MISSION.accountAddress,
    accountLat: input.accountLat ?? DEMO_MISSION.accountLat,
    accountLng: input.accountLng ?? DEMO_MISSION.accountLng,
    accountLocationCount: opportunity.locationCount,
    estimatedAnnualValueCents: opportunity.estimatedAnnualValueCents,
    estimateConfidence: opportunity.grade,
    primarySignal: opportunity.primarySignal,
    reasons: opportunity.reasons,
    decisionMaker: isCanonicalDemo
      ? DEMO_MISSION.decisionMaker
      : { name: null, title: "Operations Manager" },
    status: "selected",
  };
}
