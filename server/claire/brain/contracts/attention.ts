/**
 * Attention is an Executive Function product: which compartments to consult,
 * and which memories must not be retrieved.
 */

import type { CompartmentId } from "./retrieval";

export type AttentionLane =
  | "business"
  | "action"
  | "personal"
  | "narrative"
  | "conversation"
  | "call_control";

export type PendingDisposition = "none" | "confirm" | "reject" | "revise" | "supersede";

export type AttentionPlan = {
  lanes: AttentionLane[];
  retrieve: CompartmentId[];
  doNotRetrieve: CompartmentId[];
  /** Global proactive board. Only an unscoped broad briefing. */
  boardEligible: boolean;
  pendingDisposition: PendingDisposition;
  priorClaim: "none" | "correctness" | "provenance";
  continueOrderedQuery: boolean;
  rationale: string[];
};
