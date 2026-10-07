import type {
  OperatorContextEvidenceRef,
  OperatorContextUncertaintyReason,
} from "../persistentOperator/operatorContext";
import type { LearningKind } from "../persistentOperator/learningStore";

export type OperatorRepresentativeCategory =
  | "known"
  | "learning"
  | "uncertain"
  | "changed";

export type OperatorRepresentativeProvenanceClass =
  | "operator_declared"
  | "canonical_identity"
  | "descriptive_observation"
  | "learned_delta"
  | "uncertainty"
  | "operator_directive";

export type OperatorRepresentativeAdaptationState =
  | "active"
  | "suppressed"
  | "ask_instead"
  | "eligible_not_wired"
  | "not_eligible";

export type OperatorRepresentativeItem = {
  id: string;
  category: OperatorRepresentativeCategory;
  title: string;
  summary: string;
  provenanceClass: OperatorRepresentativeProvenanceClass;
  confidence?: "declared" | "descriptive" | "low" | "medium" | "high";
  sourceCount: number;
  evidenceAvailable: boolean;
  createdAt?: string;
  updatedAt?: string;
  targetKey?: string;
  learningKind?: LearningKind;
  uncertaintyReason?: OperatorContextUncertaintyReason;
  adaptationState: OperatorRepresentativeAdaptationState;
  canAffectAdaptation: boolean;
  activeDirectiveId?: string;
  pendingReview?: boolean;
};

export type OperatorRepresentativeHome = {
  operator: {
    canonicalOperatorId: string;
    displayName?: string | null;
  };
  generatedAt: string;
  known: OperatorRepresentativeItem[];
  learning: OperatorRepresentativeItem[];
  uncertain: OperatorRepresentativeItem[];
  changed: OperatorRepresentativeItem[];
  counts: {
    known: number;
    learning: number;
    uncertain: number;
    changed: number;
  };
  adaptation: {
    shadowEnabled: boolean;
    liveEnabled: boolean;
    canaryMode: boolean;
    activeDirectiveCount: number;
  };
};

export type OperatorRepresentativeEvidence = Pick<
  OperatorContextEvidenceRef,
  | "id"
  | "sourceSystem"
  | "sourceRecordId"
  | "timestamp"
  | "verificationClass"
  | "evidenceReference"
  | "decisionPointId"
  | "correlationId"
> & {
  businessTruthSupport: false;
};

export type OperatorRepresentativeItemDetail = {
  item: OperatorRepresentativeItem;
  meaning: string;
  provenance: string;
  evidence: OperatorRepresentativeEvidence[];
  uncertaintyReasons: OperatorContextUncertaintyReason[];
  allowedUse: string;
  forbiddenUse: string;
  canCorrect: boolean;
  canSuppress: boolean;
  canAskInstead: boolean;
  canApprove?: boolean;
  businessTruthSupport: false;
};

export type OperatorRepresentativeTalkIntent =
  | "known"
  | "learning"
  | "uncertain"
  | "changed"
  | "why"
  | "using"
  | "channel"
  | "working_time"
  | "correct"
  | "suppress"
  | "ask_instead"
  | "general";

export type OperatorRepresentativeTalkResponse = {
  reply: string;
  intent: OperatorRepresentativeTalkIntent;
  itemRefs: string[];
  evidenceRefs: string[];
  uncertainty: string[];
  suggestedActions: Array<
    "view_evidence" | "correct_item" | "suppress_item" | "ask_instead" | "undo_directive"
  >;
  needsClarification: boolean;
};
