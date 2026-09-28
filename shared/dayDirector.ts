import type { ObjectiveExecutionType } from "./objectiveExecution";
import type { DayDirectorCommandMetadata, OperatorMissionMetadata } from "./claireWorkdayCommand";

export type DayDirectorCommitment = {
  id: string;
  businessDate: string;
  title: string;
  kind: "growth" | "prep" | "operations";
  quantity: number | null;
  provenance: "user_reported" | "manual";
  status: "open" | "completed";
  completedAt: string | null;
  detailState?: "COMPLETE" | "NEEDS_DETAILS";
  missingDetails?: string[];
  detailNote?: string | null;
  scheduleKind?: string | null;
  scheduleLabel?: string | null;
  sourceText?: string | null;
  command?: DayDirectorCommandMetadata;
  operatorMission?: OperatorMissionMetadata | null;
  /** Stored type. Absent means the shared classifier may derive. Null is stored unknown. */
  executionType?: ObjectiveExecutionType | null;
};

export type DayDirectorProposal = {
  promptKey: string;
  title: string;
  kind: "growth" | "prep" | "operations";
  quantity: number | null;
  sourceText: string;
  prerequisites: string[];
  question: string | null;
  intelligence: "anthropic" | "manual_fallback";
  detailState?: "COMPLETE" | "NEEDS_DETAILS";
  missingDetails?: string[];
  detailNote?: string | null;
  /** Authoritative business date for this commitment. Voice/briefing must not silently rewrite it to today. */
  targetBusinessDate?: string | null;
  command?: DayDirectorCommandMetadata;
  operatorMission?: OperatorMissionMetadata | null;
  executionType?: ObjectiveExecutionType | null;
  recurrence?: {
    weekday: string;
    windowStart: string | null;
    windowEnd: string | null;
  } | null;
};

export type ProcessingLocation = {
  name: string;
  locality: string | null;
  address: string | null;
};
