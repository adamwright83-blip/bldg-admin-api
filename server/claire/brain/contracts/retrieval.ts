/**
 * Typed retrieval requests. Compartments return EvidenceItem[]. They do not decide the response.
 */

import type { EvidenceItem } from "./evidence";

export type CompartmentId =
  | "workingMemory"
  | "businessMemory"
  | "episodicMemory"
  | "selfMemory"
  | "goals";

export type BusinessRetrievalKind =
  | "business_query"
  | "account_state"
  | "open_orders"
  | "operations"
  | "day_line_read"
  | "field_today"
  | "workday_command"
  | "game_state"
  | "goal_progress"
  | "contact_account_resolution";

export type BusinessRetrievalRequest = {
  compartment: "businessMemory";
  kind: BusinessRetrievalKind;
  /** Opaque query object passed through to the existing authoritative reader. */
  query?: unknown;
  /**
   * Days after the call's business date an operations / workday read is for
   * ("what do you have for me tomorrow" → 1). Absent means the business date itself.
   */
  dayOffset?: number;
  accountId?: number | null;
  /** Raw mentions from Perception. Business Memory decides what they are. */
  mentions?: string[];
  contactName?: string | null;
  temporal?: string[];
};

export type EpisodicRetrievalRequest = {
  compartment: "episodicMemory";
  kind: "conversation_history" | "visit_outcomes" | "prior_actions";
  conversationKey?: string;
  accountId?: number | null;
  /**
   * Recall cues, chosen by Executive Function from RESOLVED identity.
   * The transport must never supply these — it knows about Twilio, not about what
   * Claire should try to remember.
   */
  terms?: string[];
};

export type WorkingMemoryRead = {
  compartment: "workingMemory";
  kind: "snapshot";
};

export type SelfMemoryRequest = {
  compartment: "selfMemory";
  kind: "canon" | "rapport" | "disclosure_entitlement" | "personal_ledger";
};

export type GoalPlanningRequest = {
  compartment: "goals";
  kind: "macro_goal" | "campaign" | "proactive_board_inputs" | "workday_plan";
  /** Scoped questions must not request global board inputs. */
  scoped: boolean;
};

export type PriorClaimRecheckRequest = {
  compartment: "businessMemory";
  kind: "prior_claim_recheck";
  receiptId: string;
  mode: "correctness" | "provenance";
};

export type RetrievalRequest =
  | BusinessRetrievalRequest
  | EpisodicRetrievalRequest
  | WorkingMemoryRead
  | SelfMemoryRequest
  | GoalPlanningRequest
  | PriorClaimRecheckRequest;

export type RetrievalResult = {
  request: RetrievalRequest;
  evidence: EvidenceItem[];
};
