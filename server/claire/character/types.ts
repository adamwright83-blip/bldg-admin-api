/**
 * Claire Pass 1 — shared type contracts for the character substrate.
 *
 * Operator scope (decided before implementation, do not relitigate here):
 * relationship state, disclosure tier, and shared history are keyed by
 * tenantId + operatorUserId + characterId. Phone/device identifiers are
 * transport metadata only and never substitute for identity. If operator
 * identity cannot be reliably resolved at call time, callers must fail
 * closed to Tier 0 and skip durable writes — this module never resolves
 * identity itself, it only requires callers to supply it.
 */

export type CharacterId = "claire";

export type ClaireRelationshipEventType =
  | "operator_follow_through"
  | "operator_avoidance"
  | "operator_owned_mistake"
  | "operator_respected_boundary"
  | "operator_ignored_boundary"
  | "shared_hard_win"
  | "shared_failure"
  | "claire_admitted_error"
  | "claire_disclosure"
  | "operator_handled_disclosure_well"
  | "operator_handled_disclosure_poorly";

/** A durable, append-only fact about the operator/Claire relationship. */
export type ClaireRelationshipEvent = {
  id: number;
  tenantId: string;
  operatorUserId: string;
  characterId: CharacterId;
  eventType: ClaireRelationshipEventType;
  summary: string;
  provenance: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  evidenceSource: string | null;
  occurredAt: string;
  createdAt: string;
};

export type ClaireRelationshipEventInput = {
  tenantId: string;
  operatorUserId: string;
  characterId?: CharacterId;
  eventType: ClaireRelationshipEventType;
  summary: string;
  provenance: string;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  evidenceSource?: string | null;
  occurredAt?: Date;
};

export type ClaireDisclosureTier = 0 | 1 | 2 | 3;

/** Server-owned, model-unwritable relationship dimensions. */
export type ClaireRelationshipState = {
  tenantId: string;
  operatorUserId: string;
  characterId: CharacterId;
  professionalRespect: number;
  reliability: number;
  disclosureSafety: number;
  familiarity: number;
  disclosureTier: ClaireDisclosureTier;
  qualifyingInteractionCount: number;
  distinctInteractionDays: number;
  lastEventId: number | null;
  updatedAt: string;
};

/** The Tier 0 state used whenever real state is missing or identity is unresolved. */
export const CLAIRE_DEFAULT_RELATIONSHIP_STATE: Omit<
  ClaireRelationshipState,
  "tenantId" | "operatorUserId" | "characterId" | "updatedAt"
> = {
  professionalRespect: 0,
  reliability: 0,
  disclosureSafety: 0,
  familiarity: 0,
  disclosureTier: 0,
  qualifyingInteractionCount: 0,
  distinctInteractionDays: 0,
  lastEventId: null,
};

export type ClaireTierTransition = {
  tenantId: string;
  operatorUserId: string;
  characterId: CharacterId;
  fromTier: ClaireDisclosureTier;
  toTier: ClaireDisclosureTier;
  reasons: string[];
  supportingEventIds: number[];
  createdAt: string;
};

export type ClaireTierThresholds = {
  minQualifyingInteractions: number;
  minDistinctDays: number;
};

/**
 * Central, tunable policy. Never scatter these numbers through call sites —
 * this is the one place Pass 1's starting thresholds live, so they can be
 * retuned after 30 days of field usage without touching engine code.
 */
export type ClaireRelationshipPolicy = {
  tier0to1: ClaireTierThresholds;
  tier1to2: ClaireTierThresholds & { requireMeaningfulSharedEvent: boolean };
  tier2to3: ClaireTierThresholds & {
    requirePriorDisclosureHandledWell: boolean;
  };
};

export type CanonAccessClass =
  | "core"
  | "tier_gated"
  | "never_volunteer"
  | "permanently_private";

export type CanonFragment = {
  id: string;
  accessClass: CanonAccessClass;
  /** Minimum disclosure tier required before this fragment may even be retrieved (ignored for permanently_private, which is never retrieved). */
  minTier: ClaireDisclosureTier;
  topic: string;
  fact: string;
};

export type ClaireMode =
  | "pre_drive"
  | "post_stop"
  | "failure_review"
  | "success_review"
  | "strategy"
  | "casual";

export type ClaireModePolicy = {
  objective: string;
  maxWords: number;
  fieldOverride: boolean;
};

export type CharacterDNA = {
  traits: string[];
  background: string[];
  centralWound: string;
};

export type CharacterVoiceProfile = {
  register: string;
  notes: string[];
};

export type CharacterDefinition = {
  characterId: CharacterId;
  characterVersion: string;
  displayName: string;
  dna: CharacterDNA;
  canon: CanonFragment[];
  relationshipPolicy: ClaireRelationshipPolicy;
  voiceProfile: CharacterVoiceProfile;
  modes: Record<ClaireMode, ClaireModePolicy>;
};

/** Which compiled-character/runtime version produced a given line. */
export type ClaireVersionStamp = {
  characterVersion: string;
  compilerVersion: string;
};

export type ClaireCompiledContext = {
  version: ClaireVersionStamp;
  mode: ClaireMode;
  disclosureTier: ClaireDisclosureTier;
  personalityLock: string;
  sharedHistorySummaries: string[];
  eligibleCanonFacts: string[];
  fewShotBlock: string | null;
  promptSection: string;
};
