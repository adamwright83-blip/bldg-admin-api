/**
 * Slice 4 — Mission Director types shared between server and client.
 * See docs/goldline/SLICE_4_MISSION_DIRECTOR.md.
 */

export type TimePocket = {
  startsAt: string | null;
  endsAt: string | null;
  minutes: number | null;
  kind: "between_stops" | "open_ended";
  boundedBy: { before: string | null; after: string | null };
  /** Named safety reserve. Not verified travel duration. */
  travelReserveMinutes: number;
  /**
   * Named conservative deduction when stop service duration is unknown.
   * Null when no between-stops pocket exists.
   */
  unknownStopWorkReserveMinutes: number | null;
  usableMinutes: number | null;
  confidence: "high" | "low";
  warnings: string[];
};

export type RankFactor = {
  name: string;
  value: string | number | boolean | null;
  source: string;
  effect: number;
  confidence: "high" | "low" | "unknown";
};

export type MissionRankEvidence = {
  campaignId: string;
  score: number;
  confidence: "high" | "low";
  factors: RankFactor[];
  warnings: string[];
};

export const FALLBACK_ONLY_REASONS = [
  "NO_QUALIFYING_POCKET",
  "PREP_NOT_READY",
  "POCKET_CONFIDENCE_LOW",
  "SCHEDULE_DISRUPTED",
  "ROUTE_TOO_TIGHT",
] as const;
export type FallbackOnlyReason = (typeof FALLBACK_ONLY_REASONS)[number];

export const NO_PLAN_REASONS = [
  "CAMPAIGN_LIBRARY_EMPTY",
  "ALL_CAMPAIGNS_DISABLED",
  "NO_PREPARED_FALLBACK",
  "DAY_FULLY_COMMITTED",
  "SCHEDULE_DATA_INSUFFICIENT",
] as const;
export type NoPlanReason = (typeof NO_PLAN_REASONS)[number];

export type MissionSelection = {
  campaignId: string;
  title: string;
  objective: string;
  completionCondition: string;
  pocket: TimePocket;
  isFallbackVariant: boolean;
  rankEvidence: MissionRankEvidence;
};

export type MissionPlanOutcome =
  | {
      status: "planned";
      primary: MissionSelection;
      fallback: MissionSelection;
      explanation: string;
      intelligence: "deterministic" | "anthropic" | "deterministic_fallback";
      ranking: MissionRankEvidence[];
    }
  | {
      status: "fallback_only";
      fallback: MissionSelection;
      reason: FallbackOnlyReason;
      explanation: string;
      ranking: MissionRankEvidence[];
    }
  | {
      status: "no_plan";
      reason: NoPlanReason;
      remedy: string;
      ranking?: MissionRankEvidence[];
    };

export type MissionDirectorPlan = {
  id: string;
  tenantId: string;
  operatorId: string;
  businessDate: string;
  stableKey: string;
  revision: number;
  inputFingerprint: string;
  outcome: MissionPlanOutcome;
  usageOutcome: "used" | "ignored" | "wrong_mission" | null;
  createdAt: string;
};
