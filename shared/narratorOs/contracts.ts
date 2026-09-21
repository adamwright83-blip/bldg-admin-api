/**
 * Narrator OS slices A–D — domain contracts.
 *
 * Narrator OS is the runtime director of Claire’s authored life. It does not
 * invent the story. Slices A–D stop at eligibility. Dramaturgy, scene
 * selection, Narrator prompts, and Claire dialogue are out of scope.
 *
 * Extra fail-closed defaults:
 * - mayFireOffscreen = false; defaultSurface = false; playerVisibility = false
 *   unless a beat explicitly sets them. Omission is not disclosure.
 * - eligibilityDefinition = INCOMPLETE; incomplete beats cannot pass.
 * - unknown beat IDs are invalid
 * - OPEN facts/beats have no runtime value and cannot fire
 * - unresolved OPEN policy never satisfies eligibility
 * - new operators have an empty event ledger
 * - knowledge, disclosure, world-truth mutation, and story progression are
 *   never inferred from chats, CRM, customers, or logs
 * - occurrence, player visibility, Claire knowledge, disclosure permission,
 *   and authored reaction are independent flags
 * - ELIGIBLE returns the full surfaceable set; it does not pick a “best” beat
 * - NO_ELIGIBLE is success with no mutation
 * - ELIGIBLE_WITHHELD requires authored `defaultSurface: false` on every
 *   passing beat; taste / pacing / “feels early” are not inputs
 * - production mutation requires an eligibility authorization receipt
 */

export const CANON_STATUSES = ["LOCKED", "WORKING", "OPEN"] as const;
export type CanonStatus = (typeof CANON_STATUSES)[number];

export const KNOWLEDGE_PLANES = [
  "PLAYER",
  "CLAIRE",
  "CHEMIST",
  "OTHER",
] as const;
export type KnowledgePlane = (typeof KNOWLEDGE_PLANES)[number];

export const KNOWLEDGE_FACT_KINDS = [
  "EVENT_FACT",
  "CHARACTER_INTERPRETATION",
] as const;
export type KnowledgeFactKind = (typeof KNOWLEDGE_FACT_KINDS)[number];

export const NARRATIVE_EVENT_KINDS = [
  "FIRED_AUTHORED_BEAT",
  "VERIFIED_GOLDLINE_OUTCOME",
] as const;
export type NarrativeEventKind = (typeof NARRATIVE_EVENT_KINDS)[number];

export const ELIGIBILITY_OUTCOMES = [
  "NO_ELIGIBLE",
  "ELIGIBLE",
  "ELIGIBLE_WITHHELD",
] as const;
export type EligibilityOutcome = (typeof ELIGIBILITY_OUTCOMES)[number];

export const REPEATABILITY = ["repeatable", "non_repeatable"] as const;
export type Repeatability = (typeof REPEATABILITY)[number];

export const GRAPH_EDGE_KINDS = [
  "hard_prereq",
  "optional",
  "parallel",
  "repeatable",
  "non_repeatable",
  "irreversible",
  "already_consumed",
  "unresolved_thread",
  "quiet_closure",
  "offscreen_permission",
  "visibility",
  "disclosure",
  "open_unresolved",
] as const;
export type GraphEdgeKind = (typeof GRAPH_EDGE_KINDS)[number];

export const ELIGIBILITY_DEFINITIONS = ["COMPLETE", "INCOMPLETE"] as const;
export type EligibilityDefinition = (typeof ELIGIBILITY_DEFINITIONS)[number];

export const ELIGIBILITY_GATES = [
  "unknown_beat",
  "canon_status_open",
  "incomplete_eligibility",
  "prerequisite",
  "graph_dependency",
  "knowledge_requirement",
  "verified_goldline_evidence",
  "repeatability",
  "already_fired",
  "offscreen_permission",
  "time_hold_quiet",
  "visibility_default_surface",
  "open_unresolved",
  "prohibited_knowledge",
] as const;
export type EligibilityGate = (typeof ELIGIBILITY_GATES)[number];

const beatIdBrand = Symbol("NarrativeBeatId");
export type NarrativeBeatId = string & { readonly [beatIdBrand]?: true };

export function asNarrativeBeatId(id: string): NarrativeBeatId {
  if (!id || typeof id !== "string" || id.trim() !== id || id.length === 0) {
    throw new InvalidNarrativeBeatIdError(id);
  }
  return id as NarrativeBeatId;
}

export class InvalidNarrativeBeatIdError extends Error {
  readonly beatId: string;
  constructor(beatId: string) {
    super(`Unknown or invalid narrative beat id: ${JSON.stringify(beatId)}`);
    this.name = "InvalidNarrativeBeatIdError";
    this.beatId = beatId;
  }
}

export class OpenCanonHasNoRuntimeValueError extends Error {
  constructor(ref: string) {
    super(`OPEN canon has no runtime value: ${ref}`);
    this.name = "OpenCanonHasNoRuntimeValueError";
  }
}

export type AuthoredFact = {
  factId: string;
  kind: KnowledgeFactKind;
  canonStatus: CanonStatus;
  /**
   * OPEN facts must be `null`. WORKING/LOCKED may carry an authored value.
   * Runtime must not fill OPEN.
   */
  value: string | null;
  authoredSourceRef: string;
};

export type BeatPrerequisite =
  | { kind: "hard_beat"; beatId: NarrativeBeatId }
  | { kind: "optional_beat"; beatId: NarrativeBeatId }
  | { kind: "verified_goldline_outcome"; outcomeId: string }
  | { kind: "verified_goldline_any"; outcomeIds: readonly string[] }
  | {
      kind: "verified_goldline_same_target";
      priorOutcomeIds: readonly string[];
      subsequentOutcomeIds: readonly string[];
    }
  | {
      kind: "knowledge";
      plane: KnowledgePlane;
      factId: string;
      mustKnow: boolean;
    }
  | {
      kind: "narrative_state";
      key: string;
      equals?: string;
      equalsAny?: readonly string[];
    }
  | { kind: "world_truth"; factId: string }
  | {
      kind: "open_policy";
      policyId: string;
      canonStatus: "OPEN";
    };

export type EligibilityCondition =
  | BeatPrerequisite
  | { kind: "never_manufacture"; claim: string };

export type KnowledgeRequirement = {
  plane: KnowledgePlane;
  factId: string;
  mustKnow: boolean;
};

export type NarrativeKnowledgeMutation = {
  plane: KnowledgePlane;
  factId: string;
  op: "learn" | "set_interpretation";
  kind: KnowledgeFactKind;
  interpretation?: string | null;
};

export type NarrativeStateMutation = {
  key: string;
  value: string | boolean | number | null;
};

export type NarrativeVisibility = {
  playerCanSee: boolean;
  claireKnows: boolean;
  claireMayDisclose: boolean;
};

export type NarrativeDisclosureRule = {
  plane: KnowledgePlane;
  mayDisclose: boolean;
  authoredSourceRef: string;
};

export type NarrativeOffscreenPolicy = {
  mayFireOffscreen: boolean;
};

export type QuietBehavior = {
  closesForwardPossibility: boolean;
  holdWindow: {
    key: string;
    durationMs: number | null;
    canonStatus: CanonStatus;
  } | null;
};

export type AuthoredBeat = {
  id: NarrativeBeatId;
  title: string | null;
  canonStatus: CanonStatus;
  characters: readonly string[];
  prerequisites: readonly BeatPrerequisite[];
  eligibilityConditions: readonly EligibilityCondition[];
  knowledgeRequirements: readonly KnowledgeRequirement[];
  knowledgeMutations: readonly NarrativeKnowledgeMutation[];
  stateMutations: readonly NarrativeStateMutation[];
  mayFireOffscreen: boolean;
  defaultSurface: boolean;
  playerVisibility: boolean;
  disclosureRules: readonly NarrativeDisclosureRule[];
  repeatability: Repeatability;
  irreversible: boolean;
  quietBehavior: QuietBehavior | null;
  nextBeatIds: readonly NarrativeBeatId[];
  authoredSourceRef: string;
  prohibitedKnowledgeFactIds: readonly string[];
  legalChemistVerdicts?: readonly ChemistVerdict[];
  /**
   * COMPLETE only when GOLDLINE_CANON.md supplies a full machine-readable
   * eligibility definition. INCOMPLETE beats stay registered but cannot pass.
   * Absence of gates is not permission.
   */
  eligibilityDefinition: EligibilityDefinition;
  /** Why this beat is INCOMPLETE. Not an OPEN-canon fill. */
  eligibilityIncompleteReason?: string;
};

/**
 * Immutable Claire disclosure policy. Not a beat, ledger event, knowledge
 * mutation, or world-truth write. Permission is not occurrence.
 */
export const CLAIRE_DISCLOSURE_POLICY_IDS = [
  "CL-CORE",
  "CL-T1",
  "CL-T2",
  "CL-T3",
  "CL-WARM-1",
  "CL-PRIV-ADAPTED-FATHER-LAST-EXCHANGE",
  "CL-PRIV-EX-LAST-EXCHANGE",
] as const;
export type ClaireDisclosurePolicyId =
  (typeof CLAIRE_DISCLOSURE_POLICY_IDS)[number];

/** Permanently private: no authored text exists. Not beats. */
export const PERMANENTLY_PRIVATE_CLAIRE_DISCLOSURE_POLICY_IDS = [
  "CL-PRIV-ADAPTED-FATHER-LAST-EXCHANGE",
  "CL-PRIV-EX-LAST-EXCHANGE",
] as const satisfies readonly ClaireDisclosurePolicyId[];

export type ClaireDisclosurePolicy = {
  readonly id: ClaireDisclosurePolicyId;
  readonly canonStatus: CanonStatus;
  readonly governedScopeRef: string;
  readonly fromStart: boolean;
  readonly progressGated: boolean;
  readonly askOnly: boolean;
  readonly permanentlyPrivate: boolean;
  readonly authoredSourceRef: string;
};

export const CHEMIST_VERDICTS = [
  "SUPPORTS",
  "DOES_NOT_SUPPORT",
  "INSUFFICIENT",
] as const;
export type ChemistVerdict = (typeof CHEMIST_VERDICTS)[number];

export type NarrativeGraphEdge = {
  fromId: NarrativeBeatId | null;
  toId: NarrativeBeatId;
  kind: GraphEdgeKind;
  canonStatus: CanonStatus;
  policyId?: string;
};

export type KnowledgePlaneState = {
  plane: KnowledgePlane;
  knownFactIds: readonly string[];
  interpretations: Readonly<Record<string, string>>;
  factKinds: Readonly<Record<string, KnowledgeFactKind>>;
};

export type KnowledgeState = {
  readonly planes: Readonly<Record<KnowledgePlane, KnowledgePlaneState>>;
};

export type NarrativeState = {
  values: Readonly<Record<string, string | boolean | number | null>>;
  closedForwardPaths: readonly string[];
  holdOpenedAtMs: Readonly<Record<string, number>>;
};

export type VerifiedGoldlineEvidenceRef = {
  sourceType: string;
  sourceReference: string;
  classification: "authoritative_external" | "operator_attested";
};

/**
 * JSON-safe copy of a branded receipt, stored on VERIFIED_GOLDLINE_OUTCOME
 * ledger rows. Not itself a receipt. Eligibility never treats this object as
 * caller-supplied Goldline evidence. Production rehydration is a separate
 * privileged path.
 */
export type PersistedVerifiedGoldlineReceipt = {
  receiptId: string;
  tenantId: string;
  operatorUserId: string;
  outcomeId: string;
  verificationClass: "VERIFIED";
  evidenceClass: "authoritative_external" | "operator_attested";
  evidenceRef: VerifiedGoldlineEvidenceRef;
  targetRef: { kind: "goldline_target"; id: string } | null;
  occurredAtMs: number;
  producerNamespace?: string;
  sourceEventId?: string;
};

export type NarrativeEvent = {
  kind: NarrativeEventKind;
  beatId: NarrativeBeatId | null;
  goldlineOutcomeId: string | null;
  offscreen: boolean;
  playerVisible: boolean;
  evidenceRef: VerifiedGoldlineEvidenceRef | null;
  occurredAt: string;
  /**
   * Present on VERIFIED_GOLDLINE_OUTCOME rows written by ingestion.
   * Absent on FIRED_AUTHORED_BEAT and on pre-Slice-E ledger copies.
   */
  persistedVerifiedGoldline?: PersistedVerifiedGoldlineReceipt | null;
};

export type NarrativeEventLedgerEntry = NarrativeEvent & {
  id: string;
  tenantId: string;
  operatorUserId: string;
  idempotencyKey: string;
};

export type NarrativeEligibilityAuditCheck = {
  gate:
    | EligibilityGate
    | "prerequisite_detail"
    | "graph_detail"
    | "knowledge_detail";
  detail: string;
  passed: boolean | "unresolved_open";
};

export type NarrativeEligibilityAudit = {
  beatId: NarrativeBeatId;
  canonStatus: CanonStatus;
  candidateConsidered: true;
  prerequisiteChecks: readonly NarrativeEligibilityAuditCheck[];
  graphDependencyChecks: readonly NarrativeEligibilityAuditCheck[];
  knowledgeRequirementChecks: readonly NarrativeEligibilityAuditCheck[];
  verifiedGoldlineEvidenceChecks: readonly NarrativeEligibilityAuditCheck[];
  eligibilityDefinition: EligibilityDefinition;
  repeatability: Repeatability;
  alreadyFired: boolean;
  offscreenPermission: boolean;
  timeHoldQuiet: { applied: boolean; passed: boolean };
  visibility: { playerVisibility: boolean; defaultSurface: boolean };
  pass: boolean;
  failedGates: readonly EligibilityGate[];
  finalOutcome: "pass" | "fail";
};

export type NarrativeEligibilityResult = {
  outcome: EligibilityOutcome;
  eligibleBeatIds: readonly NarrativeBeatId[];
  withheldBeatIds: readonly NarrativeBeatId[];
  audit: readonly NarrativeEligibilityAudit[];
};

export const AUTHORED_BEAT_DEFAULTS = {
  mayFireOffscreen: false as const,
  defaultSurface: false as const,
  playerVisibility: false as const,
  eligibilityDefinition: "INCOMPLETE" as const,
  repeatability: "non_repeatable" as const,
  irreversible: true as const,
  quietBehavior: null,
  nextBeatIds: [] as const,
  prohibitedKnowledgeFactIds: [] as const,
  knowledgeMutations: [] as const,
  stateMutations: [] as const,
  knowledgeRequirements: [] as const,
  prerequisites: [] as const,
  eligibilityConditions: [] as const,
  disclosureRules: [] as const,
  characters: [] as const,
} satisfies Partial<AuthoredBeat>;

export function openValueMustBeNull(fact: AuthoredFact): void {
  if (fact.canonStatus === "OPEN" && fact.value !== null) {
    throw new OpenCanonHasNoRuntimeValueError(fact.factId);
  }
}

/** Occurrence, visibility, knowledge, and disclosure are independent axes. */
export type OccurrenceDisclosureAxes = {
  occurred: boolean;
  playerCanSee: boolean;
  claireKnows: boolean;
  claireMayDisclose: boolean;
  authoredReactionExists: boolean;
};

export function knowledgePlanesAreDistinct(
  a: KnowledgePlane,
  b: KnowledgePlane
): boolean {
  return a !== b;
}
