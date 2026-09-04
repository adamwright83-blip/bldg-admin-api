import type { CommercialMissionStatus } from "./commercialMission";

export const COMMERCIAL_ATTRIBUTION_CONFIDENCE = ["high", "medium", "low"] as const;
export type CommercialAttributionConfidence =
  (typeof COMMERCIAL_ATTRIBUTION_CONFIDENCE)[number];

export const COMMERCIAL_ACQUISITION_SOURCE_TYPES = [
  "explicit_campaign",
  "inherited_first_touch",
  "trusted_property",
  "manual",
] as const;
export type CommercialAcquisitionSourceType =
  (typeof COMMERCIAL_ACQUISITION_SOURCE_TYPES)[number];

export const COMMERCIAL_ACQUISITION_REVIEW_STATES = [
  "pending",
  "attributed",
  "review_required",
  "excluded",
  "reversed",
] as const;
export type CommercialAcquisitionReviewState =
  (typeof COMMERCIAL_ACQUISITION_REVIEW_STATES)[number];

export type CommercialCampaignContext = {
  campaignLinkId: string;
  accountId: number;
  missionId: number;
  pipelineId: number | null;
  campaignName: string;
  placement: string;
  collateralVersion: string;
  salespersonId: string;
  referringContactId: number | null;
  buildingSlug: string | null;
  offerKey: string | null;
};

export type CommercialOrderAcquisitionDecision = {
  sourceType: CommercialAcquisitionSourceType | null;
  confidence: CommercialAttributionConfidence | null;
  reviewState: CommercialAcquisitionReviewState;
  reason: string;
  campaign: CommercialCampaignContext | null;
  firstTouchSourceId: string | null;
};

export const COMMERCIAL_PIPELINE_STAGES = [
  "discovered",
  "qualified",
  "mission_created",
  "game_ready",
  "field_ready",
  "visit_planned",
  "visited",
  "follow_up",
  "proposal_sent",
  "pilot_requested",
  "verbal_yes",
  "won",
  "lost",
] as const;

export type CommercialPipelineStage =
  (typeof COMMERCIAL_PIPELINE_STAGES)[number];

/**
 * A completed follow-up is an attempt with an observed result. Contact alone
 * is not recovery and never implies a win. Only an explicit business outcome
 * may advance terminal mission truth.
 */
export const COMMERCIAL_FOLLOW_UP_OUTCOMES = [
  "no_contact",
  "contacted_no_decision",
  "won",
  "lost",
] as const;
export type CommercialFollowUpOutcome =
  (typeof COMMERCIAL_FOLLOW_UP_OUTCOMES)[number];

export function missionStatusForFollowUpOutcome(
  outcome: CommercialFollowUpOutcome
): "won" | "lost" | null {
  return outcome === "won" || outcome === "lost" ? outcome : null;
}

export const COMMERCIAL_PIPELINE_STAGE_LABELS: Record<
  CommercialPipelineStage,
  string
> = {
  discovered: "Discovered",
  qualified: "Qualified",
  mission_created: "Mission created",
  game_ready: "BORESLAY ready",
  field_ready: "Field ready",
  visit_planned: "Visit planned",
  visited: "Visited",
  follow_up: "Follow-up",
  proposal_sent: "Proposal sent",
  pilot_requested: "Pilot requested",
  verbal_yes: "Verbal yes",
  won: "Won",
  lost: "Lost",
};

const STAGE_RANK = new Map(
  COMMERCIAL_PIPELINE_STAGES.map((stage, index) => [stage, index])
);

export function commercialPipelineStageRank(
  stage: CommercialPipelineStage
): number {
  return STAGE_RANK.get(stage) ?? -1;
}

export function pipelineStageForMissionStatus(input: {
  status: CommercialMissionStatus;
  collateralDelivered?: boolean;
  quoteRequested?: boolean;
  pilotRequested?: boolean;
}): CommercialPipelineStage {
  if (input.status === "won") return "won";
  if (input.status === "lost") return "lost";
  if (input.status === "follow_up") {
    if (input.pilotRequested) return "pilot_requested";
    if (input.quoteRequested || input.collateralDelivered)
      return "proposal_sent";
    return "follow_up";
  }
  if (input.status === "arrived" || input.status === "visit_completed")
    return "visited";
  if (input.status === "en_route") return "visit_planned";
  if (
    input.status === "game_completed" ||
    input.status === "phone_ready" ||
    input.status === "preparing"
  )
    return "field_ready";
  if (input.status === "game_ready" || input.status === "game_active")
    return "game_ready";
  return "mission_created";
}

export function canAdvanceRelationshipStage(
  from: CommercialPipelineStage,
  to: CommercialPipelineStage
): boolean {
  const allowed: Partial<
    Record<CommercialPipelineStage, CommercialPipelineStage[]>
  > = {
    follow_up: ["proposal_sent", "pilot_requested", "verbal_yes"],
    proposal_sent: ["follow_up", "pilot_requested", "verbal_yes"],
    pilot_requested: ["follow_up", "verbal_yes"],
    verbal_yes: ["follow_up"],
  };
  return allowed[from]?.includes(to) ?? false;
}
