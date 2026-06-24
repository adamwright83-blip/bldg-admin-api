// Slice 70 — Vendor Acquisition Mission contract.
//
// A "mission" lets an operator proactively define a vendor-supply target
// (category + geography + quantity + quality gates + deadline) before any
// resident has requested that service. This is the policy layer only: it
// validates mission definitions and gates which outreach modes may ever be
// requested. It does not scout, score, contact, or send anything itself —
// that is left to the existing vendor sourcing/scoring/outreach-drafting
// spine (vendorSourcingPolicy, vendorSourcingScoringPolicy,
// vendorOutreachDraftingPolicy, vendorOutreachSendReviewPolicy), which a
// later slice will wire a mission's candidates through.
//
// Source connectors (Google/Yelp/Reddit) remain permanently disabled — see
// sourceConnectorRegistry.ts. auto_send remains permanently blocked here
// regardless of what is stored, mirroring vendorSourcingPolicy's
// isCandidateReadyForOutreach() kill switch.

export const MISSION_OUTREACH_MODES = ["draft_only", "supervised_send", "auto_send"] as const;
export type MissionOutreachMode = (typeof MISSION_OUTREACH_MODES)[number];

export const MISSION_STATUSES = ["draft", "active", "completed", "cancelled"] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

export type MissionQualityGates = {
  minGoogleRating?: number | null;
  minYelpRating?: number | null;
  minReviewVolume?: number | null;
  requireResidentialClients?: boolean;
  requireVerifiedContact?: boolean;
  excludeComplaintPatterns?: boolean;
};

export type VendorAcquisitionMissionDefinition = {
  category: string;
  geographyLabel: string;
  targetQuantity: number;
  qualityGates: MissionQualityGates;
  outreachMode: string;
  deadlineAt?: Date | null;
};

export type MissionDecision = {
  allowed: boolean;
  reasons: string[];
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isRegisteredOutreachMode(value: string): value is MissionOutreachMode {
  return MISSION_OUTREACH_MODES.includes(value as MissionOutreachMode);
}

export function isRegisteredMissionStatus(value: string): value is MissionStatus {
  return MISSION_STATUSES.includes(value as MissionStatus);
}

export function missionHasAtLeastOneQualityGate(gates: MissionQualityGates): boolean {
  return (
    typeof gates.minGoogleRating === "number" ||
    typeof gates.minYelpRating === "number" ||
    typeof gates.minReviewVolume === "number" ||
    gates.requireResidentialClients === true ||
    gates.requireVerifiedContact === true ||
    gates.excludeComplaintPatterns === true
  );
}

/**
 * Permanent kill switch: no mission may ever auto-send outreach through this
 * policy layer, regardless of what is stored on the row. Source connectors
 * for Google/Yelp/Reddit are disabled (sourceConnectorRegistry.ts) and no
 * scouting/outreach execution loop exists yet, so there is nothing safe to
 * auto-send. Mirrors vendorSourcingPolicy.isCandidateReadyForOutreach().
 */
export function missionAllowsAutoSend(): false {
  return false;
}

export function canCreateMission(
  definition: VendorAcquisitionMissionDefinition,
  now: Date = new Date(),
): MissionDecision {
  const reasons: string[] = [];
  if (!isNonEmptyString(definition.category)) reasons.push("missing_category");
  if (!isNonEmptyString(definition.geographyLabel)) reasons.push("missing_geography_label");
  if (!Number.isInteger(definition.targetQuantity) || definition.targetQuantity < 1) {
    reasons.push("invalid_target_quantity");
  }
  if (!missionHasAtLeastOneQualityGate(definition.qualityGates)) {
    reasons.push("missing_quality_gate");
  }
  if (!isRegisteredOutreachMode(definition.outreachMode)) {
    reasons.push("outreach_mode_not_registered");
  } else if (definition.outreachMode === "auto_send") {
    reasons.push("auto_send_not_yet_enabled");
  }
  if (definition.deadlineAt && definition.deadlineAt.getTime() <= now.getTime()) {
    reasons.push("deadline_not_in_future");
  }
  return { allowed: reasons.length === 0, reasons };
}

export function canActivateMission(status: string): MissionDecision {
  const reasons: string[] = [];
  if (!isRegisteredMissionStatus(status)) reasons.push("mission_status_not_registered");
  else if (status !== "draft") reasons.push("mission_not_in_draft_status");
  return { allowed: reasons.length === 0, reasons };
}

export function canCompleteMission(status: string): MissionDecision {
  const reasons: string[] = [];
  if (!isRegisteredMissionStatus(status)) reasons.push("mission_status_not_registered");
  else if (status !== "active") reasons.push("mission_not_active");
  return { allowed: reasons.length === 0, reasons };
}

export function canCancelMission(status: string): MissionDecision {
  const reasons: string[] = [];
  if (!isRegisteredMissionStatus(status)) reasons.push("mission_status_not_registered");
  else if (status === "completed" || status === "cancelled") {
    reasons.push("mission_already_terminal");
  }
  return { allowed: reasons.length === 0, reasons };
}
