/**
 * Executive control contracts.
 *
 * These describe the COGNITIVE SITUATION of a turn — how ambiguous it is, whether
 * sources disagree, how much deliberation it deserves, when to stop.
 *
 * They are control signals, never evidence. Nothing here may become a business fact,
 * and no compartment may produce them: Executive Function derives them and Executive
 * Function acts on them.
 *
 * Bounded enums are used in preference to invented floating-point scores. A number
 * only appears where it is genuinely counted (retrieval rounds, deliberation depth).
 */

/** The cognitive frame Claire is operating under. Several may coexist in one turn. */
export type TaskSetKind =
  | "business_query"
  | "account_judgment"
  | "action_proposal"
  | "pending_confirmation"
  | "personal_disclosure"
  | "broad_planning"
  | "call_closure"
  | "conversation"
  /** Operator-declared strategic work. Cognitive frame only — not a mission write. */
  | "strategic_work";

export type TaskSet = {
  kind: TaskSetKind;
  /** What the frame is about: an account, a contact, a query thread, a pending item. */
  subject: string | null;
  openedAtMs: number;
};

/**
 * How this turn differs from the last one.
 *
 * These are deliberately distinct: a parameter change inside the same task is not the
 * same event as abandoning the task, and neither is the same as being told the answer
 * itself was wrong. Collapsing them is what made pending state hijack new speech.
 */
export type ChangeClass =
  /** Same task, one parameter changes. "No, Wednesday." */
  | "local_correction"
  /** Old task stops controlling cognition; a new one takes over. "Forget Dana, sales?" */
  | "task_switch"
  /** The dimension of the problem changes. "Compare buildings instead of orders." */
  | "set_shift"
  /** Fresh authoritative evidence overturns what we believed. */
  | "belief_revision"
  /** Same proposition, evidence must be reconsidered. "Are you sure?" */
  | "prior_claim_challenge"
  /**
   * Same business-query task, but cardinality / order / named scope changed.
   * Fresh retrieval; do not walk the previous resolved set.
   * "Just show my most recent order, not the five."
   */
  | "query_requery"
  /** Nothing structural changed. */
  | "continuation";

/**
 * What happens to one working-memory slot this turn.
 *
 * SUPPRESS is the important one: state can stay remembered while being barred from
 * influencing the current turn. Deleting it instead would lose information we still
 * need in order to talk about it later.
 */
export type GateDecision =
  | "maintain"
  | "update"
  | "replace"
  | "suppress"
  | "clear"
  | "dormant";

export type WorkingMemorySlot =
  | "task_set"
  | "focus_entity"
  | "ordered_query"
  | "pending_proposal"
  | "pending_clarification"
  | "prior_claim"
  | "unresolved_reference"
  | "evidence_scope"
  /** Remembered mission/strategic frame. Output-gated independently of task-set activation. */
  | "strategic_frame";

export type GateRuling = {
  slot: WorkingMemorySlot;
  /** May this slot be WRITTEN by what just arrived? */
  input: GateDecision;
  /** May this slot INFLUENCE this turn's cognition? */
  output: "allow" | "suppress";
  why: string;
};

/** How much cognition this turn has earned. */
export type ControlMode = "fast" | "deliberate" | "verify" | "clarify";

/** What we know, and how we know it. Never a confidence percentage. */
export type EpistemicClass =
  | "known_current"
  | "known_historical"
  | "partial_current"
  | "conflicting"
  | "stale"
  | "unknown"
  | "unverifiable";

export type EpistemicState = {
  classification: EpistemicClass;
  /** Enough to answer what was actually asked. */
  sufficiency: "sufficient" | "incomplete" | "unavailable";
  coverage: "complete" | "partial" | "unknown";
  freshness: "fresh" | "aging" | "stale" | "unknown";
  /** Mentions rows could not settle. */
  unresolvedReferences: string[];
  /**
   * Whether a NEGATIVE claim is licensed. Absence of evidence is not evidence of
   * absence: without proven coverage Claire may say "I have no verified record",
   * never "that did not happen".
   */
  negativeClaimLicensed: boolean;
  /** True only after a genuine fresh reread of a challenged claim. */
  priorClaimRechecked: boolean;
  notes: string[];
};

export type ConflictKind =
  | "current_vs_historical"
  | "current_source_conflict"
  | "temporal_conflict"
  | "identity_conflict"
  | "task_conflict"
  | "authority_conflict"
  | "coverage_conflict"
  | "prior_claim_conflict";

export type Conflict = {
  kind: ConflictKind;
  detail: string;
  evidenceIds: string[];
  /** What the executive should consider doing about it. Advice, not a decision. */
  suggests: "verify" | "clarify" | "suppress_stale" | "revise_belief" | "preserve_uncertainty" | "inhibit";
};

/** Why the executive stopped looping. Always recorded, always inspectable. */
export type StoppingReason =
  | "evidence_sufficient"
  | "clarification_required"
  | "information_unavailable"
  | "low_expected_value"
  | "budget_exhausted"
  | "authority_refusal";

export type ExecutiveControlState = {
  mode: ControlMode;
  ambiguity: "none" | "resolvable" | "requires_clarification";
  change: ChangeClass;
  activeTaskSets: TaskSet[];
  /** Full input/output gate rulings, retained for inspectable shadow cognition. */
  workingMemoryGates: GateRuling[];
  suppressedContext: WorkingMemorySlot[];
  epistemic: EpistemicState;
  conflicts: Conflict[];
  /** Risk of the action under discussion, if any. */
  actionRisk: "none" | "proposal_only" | "mutating";
  /** How many retrieval rounds have run. */
  retrievalRounds: number;
  /** How many times control escalated this turn. */
  deliberationDepth: number;
  needsVerification: boolean;
  stoppingReason: StoppingReason | null;
};

/** A turn starts with no conflicts, nothing known, and nothing suppressed. */
export function initialControlState(): ExecutiveControlState {
  return {
    mode: "fast",
    ambiguity: "none",
    change: "continuation",
    activeTaskSets: [],
    workingMemoryGates: [],
    suppressedContext: [],
    epistemic: {
      classification: "unknown",
      sufficiency: "unavailable",
      coverage: "unknown",
      freshness: "unknown",
      unresolvedReferences: [],
      negativeClaimLicensed: false,
      priorClaimRechecked: false,
      notes: [],
    },
    conflicts: [],
    actionRisk: "none",
    retrievalRounds: 0,
    deliberationDepth: 0,
    needsVerification: false,
    stoppingReason: null,
  };
}

/**
 * Hierarchical control. A higher level may CONSTRAIN a lower one; it may never
 * execute it. This is what stops "grow sales" from hijacking "what was Thomas's
 * last order?".
 */
export type ControlLevel =
  | "meta_goal"
  | "strategy"
  | "task_set"
  | "immediate_intention"
  | "proposed_action"
  | "executable_action";

export const CONTROL_LEVEL_ORDER: readonly ControlLevel[] = [
  "meta_goal",
  "strategy",
  "task_set",
  "immediate_intention",
  "proposed_action",
  "executable_action",
];

/** A level may only inform the level directly beneath it, and never skip to execution. */
export function mayConstrain(higher: ControlLevel, lower: ControlLevel): boolean {
  const a = CONTROL_LEVEL_ORDER.indexOf(higher);
  const b = CONTROL_LEVEL_ORDER.indexOf(lower);
  if (a < 0 || b < 0 || a >= b) return false;
  return !(lower === "executable_action" && higher !== "proposed_action");
}

/**
 * Lifecycle of an intention, from first mention to durable offloading.
 *
 * `offloaded` is the important state: once work is stored in Day Line, the intention
 * lives THERE. Working Memory keeps a lightweight reference so Claire can discuss it,
 * and stops treating it as an active proposal — which is what prevents an old plan
 * from haunting unrelated turns.
 */
export type IntentionStatus =
  | "proposed"
  | "awaiting_confirmation"
  | "authorized"
  | "offloaded"
  | "active"
  | "completed"
  | "rejected"
  | "cancelled"
  | "superseded";

export type Intention = {
  id: string;
  title: string;
  status: IntentionStatus;
  /** Where the durable copy lives once offloaded. */
  externalRef: string | null;
  updatedAtMs: number;
};

/** Statuses that must no longer influence a new, unrelated turn. */
const CLOSED_INTENTIONS: ReadonlySet<IntentionStatus> = new Set([
  "offloaded",
  "completed",
  "rejected",
  "cancelled",
  "superseded",
]);

export function intentionIsClosed(status: IntentionStatus): boolean {
  return CLOSED_INTENTIONS.has(status);
}
