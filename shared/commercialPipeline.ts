import type { CommercialMissionStatus } from "./commercialMission";

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
