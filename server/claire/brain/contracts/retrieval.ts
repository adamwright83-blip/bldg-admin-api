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
  | "contact_account_resolution";

export type BusinessRetrievalRequest = {
  compartment: "businessMemory";
  kind: BusinessRetrievalKind;
  /** Opaque query object passed through to the existing authoritative reader. */
  query?: unknown;
  accountId?: number | null;
  contactName?: string | null;
  temporal?: string[];
};

export type EpisodicRetrievalRequest = {
  compartment: "episodicMemory";
  kind: "conversation_history" | "visit_outcomes" | "prior_actions";
  conversationKey?: string;
  accountId?: number | null;
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
