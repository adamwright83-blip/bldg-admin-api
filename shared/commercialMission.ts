export const COMMERCIAL_MISSION_STATUSES = [
  "candidate",
  "selected",
  "game_ready",
  "game_active",
  "game_completed",
  "phone_ready",
  "preparing",
  "en_route",
  "arrived",
  "visit_completed",
  "follow_up",
  "won",
  "lost",
] as const;

export type CommercialMissionStatus = (typeof COMMERCIAL_MISSION_STATUSES)[number];
export type CommercialMissionConfidence = "low" | "medium" | "high";

export type CommercialMissionAccountSnapshot = {
  accountId: number;
  name: string;
  accountType: string;
  address: string;
  latitude: number;
  longitude: number;
  locationCount: number;
  decisionMaker: { name: string | null; title: string | null };
};

export type CommercialMissionOpportunitySnapshot = {
  opportunityId: number | null;
  estimatedAnnualValueCents: number;
  estimateConfidence: CommercialMissionConfidence;
  score: number;
  primarySignal: string;
  reasons: string[];
  risks: string[];
};

export type CommercialMissionBrief = {
  laundryOpportunity: string;
  salesAngle: string;
  openingLine: string;
  discoveryQuestions: string[];
  objections: string[];
};

export type CommercialMissionStep = {
  key: string;
  label: string;
  detail: string;
  status: "locked" | "ready" | "active" | "completed" | "skipped";
  position: number;
};

export type CommercialMission = {
  id: number;
  tenantId: string;
  code: string;
  status: CommercialMissionStatus;
  version: number;
  assignedTo: string | null;
  opsTaskId: number | null;
  account: CommercialMissionAccountSnapshot;
  opportunity: CommercialMissionOpportunitySnapshot;
  brief: CommercialMissionBrief;
  steps: CommercialMissionStep[];
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type CommercialMissionContinuitySurface = {
  missionId: number;
  code: string;
  accountName: string;
  estimatedAnnualValueCents: number;
  decisionMakerName: string | null;
  decisionMakerTitle: string | null;
};

export function formatMissionCode(id: number): string {
  return `MISSION ${String(id).padStart(3, "0")}`;
}

export function toCommercialMissionContinuitySurface(
  mission: CommercialMission,
): CommercialMissionContinuitySurface {
  return {
    missionId: mission.id,
    code: mission.code,
    accountName: mission.account.name,
    estimatedAnnualValueCents: mission.opportunity.estimatedAnnualValueCents,
    decisionMakerName: mission.account.decisionMaker.name,
    decisionMakerTitle: mission.account.decisionMaker.title,
  };
}

export function assertCommercialMissionContinuity(
  mission: CommercialMission,
  surfaces: CommercialMissionContinuitySurface[],
): void {
  const expected = toCommercialMissionContinuitySurface(mission);
  for (const surface of surfaces) {
    if (JSON.stringify(surface) !== JSON.stringify(expected)) {
      throw new Error(
        `Commercial mission continuity failed for mission ${mission.id}. Every surface must render the persisted snapshot.`,
      );
    }
  }
}
