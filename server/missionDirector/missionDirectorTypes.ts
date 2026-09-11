/**
 * Slice 4 — Mission Director v1 server-side types. The display-relevant
 * shapes live in shared/missionDirector.ts so the client can consume the
 * same types the server produces without duplication (matching the
 * AuthoredDayRecord / shared/authoredDay.ts convention).
 * See docs/goldline/SLICE_4_MISSION_DIRECTOR.md §§3-6.
 */
export {
  FALLBACK_ONLY_REASONS,
  NO_PLAN_REASONS,
  type FallbackOnlyReason,
  type MissionDirectorPlan,
  type MissionPlanOutcome,
  type MissionSelection,
  type NoPlanReason,
  type TimePocket,
} from "../../shared/missionDirector";

export type CampaignRejection = {
  campaignId: string;
  reason: "PREP_NOT_READY" | "DISABLED";
  detail: string;
};
