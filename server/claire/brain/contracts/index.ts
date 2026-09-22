export type {
  PerceivedTurn,
  Completeness,
  DialogueActKind,
  BusinessIntentKind,
  PerceivedEntity,
  CallControlSignal,
  WorkDeclarationKind,
  AttentionRepairKind,
  WorkFrameClassifierStatus,
  StrategicShape,
} from "./perceivedTurn";
export type {
  WorkingMemorySnapshot,
  OrderedQueryMemory,
  OrderedQueryMember,
  FocusEntity,
  PendingProposalSnapshot,
  PriorClaimRef,
  StrategicWorkMemory,
} from "./workingMemory";
export type {
  EvidenceItem,
  EvidenceRef,
  EvidenceType,
  EvidenceAuthority,
  EvidenceProvenance,
  EvidenceFreshness,
  EvidenceCoverage,
  PriorClaimRecheckResult,
  PriorClaimRecheckResolution,
} from "./evidence";
export type {
  CompartmentId,
  RetrievalRequest,
  RetrievalResult,
  BusinessRetrievalRequest,
  EpisodicRetrievalRequest,
  WorkingMemoryRead,
  SelfMemoryRequest,
  GoalPlanningRequest,
  PriorClaimRecheckRequest,
} from "./retrieval";
export {
  EXECUTIVE_ACTION_GRANT_BRAND,
  CALL_CONTROL_GRANT_BRAND,
  PERSONAL_DISCLOSURE_GRANT_BRAND,
  NARRATIVE_REVEAL_GRANT_BRAND,
} from "./grants";
export type {
  ExecutiveActionGrant,
  CallControlGrant,
  PersonalDisclosureGrant,
  NarrativeRevealGrant,
  ActionClass,
  ActionAuthorityBasis,
  ActionGrantDraft,
  CallControlGrantDraft,
  PersonalDisclosureGrantDraft,
  NarrativeRevealGrantDraft,
} from "./grants";
export type { AttentionPlan, AttentionLane, PendingDisposition } from "./attention";
export type {
  ResponsePlan,
  ResponseSegment,
  BusinessFactSegment,
  BusinessJudgmentSegment,
  ActionProposalSegment,
  ActionConfirmationSegment,
  PersonalDisclosureSegment,
  NarrativeRevealSegment,
  ConversationalSegment,
  CognitiveAcknowledgementSegment,
  CognitiveAcknowledgementKind,
  PlanningAuthorityNotTouched,
  CallControlSegment,
} from "./responsePlan";
export { PLANNING_AUTHORITIES_NOT_TOUCHED } from "./responsePlan";
export type {
  ExecutiveDecision,
  InhibitedCandidate,
  Conclusion,
  CallControlDecision,
} from "./executiveDecision";

/** Compile-time flag. Runtime copies live on ExecutiveDecision.productionAuthority. */
export const BRAIN_V2_PRODUCTION_AUTHORITY = false as const;
