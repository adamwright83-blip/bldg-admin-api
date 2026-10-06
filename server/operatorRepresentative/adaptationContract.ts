export const DAPHNE_STAGE3B_TARGET_KEY =
  "pattern:explicit_deferral_dismissal" as const;

export const DAPHNE_STAGE3B_BEHAVIOR_CLASS =
  "ask_before_ambiguous_pending_continuation" as const;

export const DAPHNE_STAGE3B_STRUCTURAL_OUTCOME =
  "clarification_branch_selected" as const;

export const DAPHNE_STAGE3B_RECEIPT_CLASS =
  "non_business_claire_behavior" as const;

export const DAPHNE_STAGE3B_FIREWALL_RESULT =
  "non_business_behavior_only" as const;

export type DaphneAdaptationBehaviorClass =
  typeof DAPHNE_STAGE3B_BEHAVIOR_CLASS;

export type OperatorAdaptationDecision = {
  tenantId: string;
  canonicalOperatorId: string;
  directiveId: string;
  targetKey: typeof DAPHNE_STAGE3B_TARGET_KEY;
  behaviorClass: DaphneAdaptationBehaviorClass;
  status: "applicable";
};

export type DaphneAdaptationApplicationResult = {
  directiveId: string;
  targetKey: typeof DAPHNE_STAGE3B_TARGET_KEY;
  behaviorClass: DaphneAdaptationBehaviorClass;
  structuralOutcome: typeof DAPHNE_STAGE3B_STRUCTURAL_OUTCOME;
  branch: "clarify";
  businessTruthMutation: false;
};

export type DaphneAdaptationLifecycleState =
  | "unwired"
  | "wired_unused"
  | "used"
  | "revoked_historical";

export function buildDaphneClarificationApplicationResult(
  decision: OperatorAdaptationDecision
): DaphneAdaptationApplicationResult {
  return {
    directiveId: decision.directiveId,
    targetKey: DAPHNE_STAGE3B_TARGET_KEY,
    behaviorClass: DAPHNE_STAGE3B_BEHAVIOR_CLASS,
    structuralOutcome: DAPHNE_STAGE3B_STRUCTURAL_OUTCOME,
    branch: "clarify",
    businessTruthMutation: false,
  };
}
