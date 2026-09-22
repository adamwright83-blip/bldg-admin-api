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
import type { OrderedQueryMember, StrategicWorkMemory } from "./workingMemory";
import type { ExecutiveControlState } from "./control";
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
    | "half_turn"
    | "attention_repair_as_claim_challenge"
    | "operator_intent_as_external_fact"
    | "mission_as_generic_day_line";
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
  /** How this turn was reasoned about. Control signals, never evidence. */
  control: ExecutiveControlState;
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
    /** Null means the previous ordered-query thread was invalidated and not replaced. */
    orderedQuery?: OrderedQueryUpdate | null;
    continuationPresented?: OrderedQueryMember[];
    /**
     * Present only when this turn opens or fills the strategic frame.
     * Omitted means the previous frame is left untouched. Null clears it — unused,
     * because a declaration is not deleted by an unrelated turn.
     */
    activeWorkFrame?: StrategicWorkMemory | null;
  };
};
