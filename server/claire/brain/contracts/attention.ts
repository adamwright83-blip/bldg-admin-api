/**
 * Attention is an Executive Function product: which compartments to consult, which
 * memories must NOT be consulted, and which cognitive frames are active.
 *
 * `suppressedContext` is what stops salient-but-irrelevant memory from hijacking a
 * turn. A suppressed slot is still remembered — it simply may not influence this turn.
 */

import type { CompartmentId } from "./retrieval";
import type { TaskSet, WorkingMemorySlot } from "./control";

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
  /** The cognitive frames this turn operates under. Several may coexist. */
  activeTaskSets: TaskSet[];
  /** Working-memory slots barred from influencing this turn. */
  suppressedContext: WorkingMemorySlot[];
  /** Mentions that must be resolved before scoped retrieval can be planned. */
  entitiesToResolve: string[];
  /** Global proactive board. Only an unscoped broad briefing. */
  boardEligible: boolean;
  pendingDisposition: PendingDisposition;
  priorClaim: "none" | "correctness" | "provenance";
  continueOrderedQuery: boolean;
  rationale: string[];
};
