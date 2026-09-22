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
  | "attention_repair"
  | "continue";

/**
 * How the operator's words relate to work. Descriptive only.
 * This enum is not an authority object and cannot mint a grant.
 */
export type WorkDeclarationKind =
  | "none"
  | "ordinary_work"
  | "explicit_day_line"
  | "explicit_action"
  | "strategic_work"
  | "context_narration";

/** Dialogue act: the operator is repairing attention or leaving the current subject. */
export type AttentionRepairKind = "none" | "attention_repair" | "subject_change";

/**
 * Bounded classifier outcome. `unknown` and `failed` are not authority.
 * Executive Function must fail them toward hold, not toward a proposal.
 */
export type WorkFrameClassifierStatus = "classified" | "unknown" | "failed";

/** Whether a strategic frame, if any, already names its content. */
export type StrategicShape = "none" | "unresolved" | "content";

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
  /**
   * Work-frame description from the bounded classifier. Not evidence and not a grant.
   * `unknown` / `failed` must not be promoted into action authority.
   */
  classifierStatus: WorkFrameClassifierStatus;
  workDeclarationKind: WorkDeclarationKind;
  attentionRepair: AttentionRepairKind;
  /** The operator attested their own intention. That is not an external business fact. */
  operatorIntentAttested: boolean;
  /** A separate claim about the world (a debt, a price) sits inside the utterance. */
  embeddedExternalFact: boolean;
  /** Operator asked to persist today's mission. Only an existing canonical action could. */
  explicitMissionWriteRequest: boolean;
  /** Desire pointed at a thing, with no complement yet. Not a finished declaration. */
  openFragment: boolean;
  strategicShape: StrategicShape;
  /**
   * Bounded complement of a declaration ("publish the ad"), not a transcript copy.
   * Null when the frame is open but the content has not been said.
   */
  declaredContentLabel: string | null;
};
