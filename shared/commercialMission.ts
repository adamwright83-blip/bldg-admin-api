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

export const COMMERCIAL_CONTACT_RELATIONSHIP_TYPES = [
  "decision_maker",
  "gatekeeper",
  "champion",
  "concierge",
  "front_desk",
  "security",
  "operations",
  "other",
  "unknown",
] as const;

export type CommercialContactRelationshipType =
  (typeof COMMERCIAL_CONTACT_RELATIONSHIP_TYPES)[number];

export const COMMERCIAL_CONTACT_PREFERRED_CHANNELS = [
  "email",
  "sms",
  "phone",
  "unknown",
] as const;

export type CommercialContactPreferredChannel =
  (typeof COMMERCIAL_CONTACT_PREFERRED_CHANNELS)[number];

export const COMMERCIAL_CONTACT_SOURCES = [
  "provider_sourced",
  "operator_observation",
  "crm_history",
  "public_website",
  "public_territory_preview",
  "unplanned_walk_in",
  "field_visit",
  "imported",
  "unknown",
] as const;

export type CommercialContactSource =
  (typeof COMMERCIAL_CONTACT_SOURCES)[number];

export type CommercialMissionContactSnapshot = {
  name: string | null;
  title: string | null;
  email?: string | null;
  phone?: string | null;
  relationshipType?: CommercialContactRelationshipType | null;
  preferredChannel?: CommercialContactPreferredChannel | null;
  source?: CommercialContactSource | null;
  sourceUrl?: string | null;
  sourcedAt?: string | null;
  notes?: string | null;
};

export type CommercialMissionAccountSnapshot = {
  accountId: number;
  providerName?: string | null;
  providerAccountId?: string | null;
  name: string;
  accountType: string;
  website?: string | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  locationCount: number;
  decisionMaker: CommercialMissionContactSnapshot;
};

export type CommercialMissionOpportunitySnapshot = {
  opportunityId: number | null;
  estimatedAnnualValueCents: number | null;
  estimateConfidence: CommercialMissionConfidence;
  score: number;
  primarySignal: string;
  reasons: string[];
  risks: string[];
  evidence?: Array<Record<string, unknown>>;
};

export type CommercialMissionBrief = {
  laundryOpportunity: string;
  salesAngle: string;
  openingLine: string;
  discoveryQuestions: string[];
  objections: string[];
};

export const COMMERCIAL_MISSION_STEP_TYPES = [
  "generic",
  "wardrobe_review",
  "route_stop",
  "collateral_pickup",
  "purchase_stop",
  "sales_training",
  "field_visit",
  "debrief",
] as const;

export type CommercialMissionStepType =
  (typeof COMMERCIAL_MISSION_STEP_TYPES)[number];

export const COMMERCIAL_MISSION_STEP_STATUSES = [
  "locked",
  "ready",
  "active",
  "awaiting_review",
  "rejected",
  "completed",
  "skipped",
  "cancelled",
] as const;

export type CommercialMissionStepStatus =
  (typeof COMMERCIAL_MISSION_STEP_STATUSES)[number];

export type CommercialMissionProofRequirement =
  | "none"
  | "confirmation"
  | "photo"
  | "photo_optional";

export type CommercialMissionVerificationState =
  | "not_required"
  | "pending"
  | "approved"
  | "rejected"
  | "overridden";

export type CommercialMissionFulfillmentMode =
  | "not_applicable"
  | "live_provider"
  | "staged_demo"
  | "manual_fulfillment";

export type CommercialMissionStep = {
  key: string;
  label: string;
  detail: string;
  type?: CommercialMissionStepType;
  status: CommercialMissionStepStatus;
  position: number;
  instructionText?: string | null;
  revealPolicy?: "sequential" | "immediate" | "admin_only";
  destinationName?: string | null;
  destinationAddress?: string | null;
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
  mapsUrl?: string | null;
  countdownDurationSeconds?: number | null;
  startedAt?: string | null;
  deadlineAt?: string | null;
  completedAt?: string | null;
  proofRequirement?: CommercialMissionProofRequirement;
  referenceImageUrl?: string | null;
  instructionVideoUrl?: string | null;
  pinnedCoachingArtifactId?: string | null;
  verificationState?: CommercialMissionVerificationState;
  proofAssetId?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  rejectionReason?: string | null;
  fulfillmentMode?: CommercialMissionFulfillmentMode;
  metadata?: Record<string, unknown>;
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
  estimatedAnnualValueCents: number | null;
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
