/**
 * PerceivedTurn — Perception's output. Informs Executive Function.
 * Perception does not route, mutate, disclose, or hang up.
 */

export type Completeness = "complete" | "incomplete" | "forced_flush";

export type DialogueActKind =
  | "question"
  | "acknowledgement"
  | "refusal"
  | "correction"
  | "commitment"
  | "directive"
  | "confide"
  | "greeting"
  | "leave_taking"
  | "continue";

export type BusinessIntentKind =
  | "fact_question"
  | "judgment_question"
  | "list_query"
  | "query_refinement"
  | "query_requery"
  | "correctness_challenge"
  | "provenance_question"
  | "broad_briefing"
  | "none";

/**
 * A mention, not an identity.
 *
 * Perception reports THAT something was named. It does not decide whether that thing
 * is a person or an account — a person's name can be two words and an account's can be
 * one, so any whitespace-based guess is simply wrong some of the time. Resolution is
 * Business Memory's job, against authoritative contact and account rows.
 */
export type PerceivedEntity = {
  raw: string;
  /** Temporal tokens are never person/account names ("Dana Tuesday" → Dana + Tuesday). */
  kind: "entity_mention" | "temporal";
};

export type CallControlSignal = "end" | "continue";

export type PerceivedTurn = {
  rawText: string;
  assembledText: string;
  completeness: Completeness;
  dialogueActs: DialogueActKind[];
  businessIntent: BusinessIntentKind;
  entities: PerceivedEntity[];
  temporalReferences: string[];
  cardinality: number | null;
  ordering: "last" | "first" | "before_anchor" | "after_anchor" | null;
  exclusions: string[];
  anchorEntity: string | null;
  priorQueryReference: boolean;
  correction: boolean;
  correctionTarget: "pending_item" | "prior_claim" | "prior_query" | null;
  refusal: boolean;
  acknowledgement: boolean;
  explicitActionRequest: boolean;
  operatorWorkCommitment: boolean;
  personalProbe: boolean;
  narrativeProbe: boolean;
  callControl: CallControlSignal;
  ambiguities: string[];
  /**
   * Hint from `interpretTurn.mayProposeWork`. NEVER action authority.
   * Executive Function may inhibit this hint.
   */
  mayProposeWorkHint: boolean;
  hasBusinessQuestion: boolean;
  listRequest: boolean;
  broadBriefingRequest: boolean;
  aboutClaireCapability: boolean;
};
