/**
 * Exactly one ExecutiveDecision per completed turn.
 * This is the only sovereign output of Brain V2.
 */

import type { AttentionPlan } from "./attention";
import type { EvidenceItem } from "./evidence";
import type { CallControlGrant, ExecutiveActionGrant } from "./grants";
import type { PerceivedTurn } from "./perceivedTurn";
import type { RetrievalRequest } from "./retrieval";
import type { ResponsePlan, ResponseSegment } from "./responsePlan";
import type { OrderedQueryMember } from "./workingMemory";
import type { OrderedQueryUpdate } from "../executive/integrate";

export type InhibitedCandidate = {
  kind:
    | "episodic_as_current_truth"
    | "parser_text_as_action_authority"
    | "pending_as_intent"
    | "rapport_suppresses_business"
    | "stale_receipt_as_fresh_proof"
    | "recommendation_as_mutation"
    | "narrative_withholds_business"
    | "global_goal_contaminates_scope"
    | "model_statement_as_evidence"
    | "synthetic_evidence"
    | "call_end_without_leave_taking"
    | "half_turn";
  detail: string;
};

/**
 * Recorded when a business lane ran but produced no renderable answer. The governor
 * accepts this as the honest alternative to a business segment on a mixed turn; it may
 * never be used to paper over a business answer that personal/narrative suppressed.
 */
export const BUSINESS_ANSWER_UNAVAILABLE = "business_answer_unavailable";

export type Conclusion = {
  kind: string;
  detail: string;
  evidenceIds: string[];
};

export type CallControlDecision =
  | { endCall: false }
  | { endCall: true; grant: CallControlGrant };

export type ExecutiveDecision = {
  perceivedTurn: PerceivedTurn;
  attention: AttentionPlan;
  retrievals: RetrievalRequest[];
  evidence: EvidenceItem[];
  conclusions: Conclusion[];
  inhibitedCandidates: InhibitedCandidate[];
  responsePlan: ResponsePlan;
  /** Convenience alias of responsePlan.segments (same array). */
  responseSegments: ResponseSegment[];
  actionGrants: ExecutiveActionGrant[];
  callControl: CallControlDecision;
  /** Always false until an authorized cutover. */
  productionAuthority: false;
  /**
   * What this turn resolved and what it actually presented, for the NEXT turn's
   * continuation. Cognitive bookkeeping only — it grants nothing and mutates nothing.
   */
  workingMemoryUpdate?: {
    orderedQuery?: OrderedQueryUpdate;
    continuationPresented?: OrderedQueryMember[];
  };
};
