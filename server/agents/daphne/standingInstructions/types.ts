/**
 * Claire standing instructions: durable operator rules about how Claire behaves on calls.
 * Owned by Daphne (operator preference learning) per ARCHITECTURE.md; Claire reads them.
 */
export const STANDING_INSTRUCTION_KINDS = [
  "encouragement_every_call",
  "review_window",
  "role_feedback",
  "call_rule",
] as const;
export type StandingInstructionKind = (typeof STANDING_INSTRUCTION_KINDS)[number];

/** weekday: 0 = Sunday … 6 = Saturday. Minutes are local minutes since midnight; null means the whole day. */
export type ReviewWindowPayload = {
  weekday: number;
  startMinutes: number | null;
  endMinutes: number | null;
  topics: string[];
};

export type RoleFeedbackPayload = {
  obligation: "open_with_goal_and_plan";
};

export type DetectedStandingInstruction = {
  kind: StandingInstructionKind;
  subjectKey: string;
  status: "active" | "revoked";
  /** The rule in Claire's own terms. This, not the quote, is what the prompt states. */
  text: string;
  /** The operator's exact words. Stored for audit and shown on Claire Desk. */
  quote: string;
  payload: Record<string, unknown> | null;
};

export type StandingInstructionRecord = {
  id: string;
  tenantId: string;
  canonicalOperatorId: string;
  operatorUserId: string;
  kind: StandingInstructionKind;
  subjectKey: string;
  version: number;
  status: "active" | "revoked";
  text: string;
  quote: string;
  payload: Record<string, unknown> | null;
  sourceConversationKey: string;
  sourceTurnId: string;
  createdAt: string;
};

export const REVIEW_TOPIC_OVERDUE_FOLLOWUPS = "overdue_followups";
