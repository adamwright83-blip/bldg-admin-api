import type { Day1TargetOutcome } from "./day1TenDoors";

export type Day1EvidenceSource =
  | "gps"
  | "operator_confirmed"
  | "operator_backfill";

export type Day1DecisionMakerStatus =
  | "reached"
  | "unavailable"
  | "not_recorded";

export type Day1EvidenceEventKind =
  | "navigation_opened"
  | "arrived"
  | "pitch_recorded"
  | "couldnt_reach_recorded"
  | "follow_up_sent"
  | "reply_received"
  | "meeting_booked"
  | "account_won"
  | "account_lost"
  | "revenue_recorded";

/**
 * A durable evidence event stored inside the EXISTING Day 1 task.detail JSON.
 * `recordedAt` is always a server timestamp. It deliberately does not claim
 * to be the historical occurrence time for operator_backfill events.
 */
export type Day1EvidenceEvent = {
  id: string;
  targetId: string;
  kind: Day1EvidenceEventKind;
  recordedAt: string;
  source: Day1EvidenceSource;
  lat: number | null;
  lng: number | null;
  accuracyMeters: number | null;
  decisionMaker: Day1DecisionMakerStatus | null;
  followUpNeeded: boolean | null;
  amountCents: number | null;
};

export type Day1VisitEvidence = {
  targetId: string;
  arrivalRecordedAt: string | null;
  arrivalSource: Day1EvidenceSource | null;
  lat: number | null;
  lng: number | null;
  accuracyMeters: number | null;
  outcomeRecordedAt: string | null;
  outcomeSource: Day1EvidenceSource | null;
  outcome: Day1TargetOutcome | null;
  decisionMaker: Day1DecisionMakerStatus | null;
  followUpNeeded: boolean | null;
};

/** Optional extension fields on the legacy JSON payload. Old rows decode unchanged. */
export type Day1EvidencePayloadExtension = {
  evidenceEvents?: Day1EvidenceEvent[];
  visitEvidence?: Record<string, Day1VisitEvidence>;
};

export type Day1RecordEvidenceInput = {
  eventId: string;
  targetId: string;
  kind: Exclude<
    Day1EvidenceEventKind,
    "pitch_recorded" | "couldnt_reach_recorded"
  >;
  source: Day1EvidenceSource;
  lat?: number | null;
  lng?: number | null;
  accuracyMeters?: number | null;
  amountCents?: number | null;
};

export type Day1OutcomeEvidence = {
  requestId?: string;
  decisionMaker?: Day1DecisionMakerStatus;
  followUpNeeded?: boolean;
  source?: Day1EvidenceSource;
};
