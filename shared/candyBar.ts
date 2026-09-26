/**
 * Candy Bar V0 — durable self-driving development orchestrator contracts.
 * Agents propose; Candy Bar verifies. Provider output never mutates authority,
 * standing goals, approvals, merge, deploy, or credentials.
 */

export const CANDY_BAR_ALLOWED_REPOSITORY = "adamwright83-blip/bldg-admin-api" as const;

export const CANDY_BAR_RUN_STATES = [
  "CREATED",
  "ASSEMBLING_CONTEXT",
  "ARCHITECT_RUNNING",
  "ARCHITECT_COMPLETE",
  "REVIEWER_RUNNING",
  "REVIEW_COMPLETE",
  "RECONCILING",
  "BRIEF_READY",
  "AUTHORITY_CLASSIFIED",
  "ENGINEER_RUNNING",
  "PR_OPEN",
  "CI_RUNNING",
  "REPAIR_REQUIRED",
  "ENGINEER_REPAIRING",
  "READY_FOR_HUMAN",
  "NEEDS_HUMAN",
  "BLOCKED",
  "COMPLETED",
  "CANCELLED",
] as const;

export type CandyBarRunState = (typeof CANDY_BAR_RUN_STATES)[number];

export const CANDY_BAR_AUTHORITY_LEVELS = [
  "AUTONOMOUS_EXECUTION",
  "AUTONOMOUS_PRODUCT_ELABORATION",
  "PROPOSAL_AUTHORITY",
  "HARD_HUMAN_GATE",
] as const;

export type CandyBarAuthorityLevel = (typeof CANDY_BAR_AUTHORITY_LEVELS)[number];

export const CANDY_BAR_STEP_KINDS = [
  "context_assembly",
  "architect",
  "reviewer",
  "reconcile",
  "authority_classify",
  "engineer",
  "pr_observation",
  "ci_observation",
  "repair",
  "human_gate",
] as const;

export type CandyBarStepKind = (typeof CANDY_BAR_STEP_KINDS)[number];

export const CANDY_BAR_STEP_STATUSES = [
  "pending",
  "ready",
  "leased",
  "running",
  "completed",
  "failed",
  "cancelled",
  "retry_scheduled",
] as const;

export type CandyBarStepStatus = (typeof CANDY_BAR_STEP_STATUSES)[number];

export const CANDY_BAR_ARTIFACT_TYPES = [
  "REPO_CONTEXT",
  "ARCHITECT_PLAN",
  "REVIEW_CRITIQUE",
  "RECONCILED_IMPLEMENTATION_BRIEF",
  "AUTHORITY_CLASSIFICATION",
  "ENGINEERING_TERMINAL_RESULT",
  "PR_STATUS",
  "CI_STATUS",
  "REPAIR_BRIEF",
  "OBJECTIVE_REDEFINITION_PROPOSAL",
  "CREATIVE_TREATMENT",
  "CANDIDATE_BUILD",
  "KEEP_REJECT_NOTES",
] as const;

export type CandyBarArtifactType = (typeof CANDY_BAR_ARTIFACT_TYPES)[number];

export const CANDY_BAR_PROVIDER_IDS = [
  "openai",
  "anthropic",
  "xai_grok",
  "cursor",
  "github",
  "fake",
  "system",
] as const;

export type CandyBarProviderId = (typeof CANDY_BAR_PROVIDER_IDS)[number];

export const CANDY_BAR_HUMAN_GATE_REASONS = [
  "OBJECTIVE_REDEFINITION",
  "HARD_HUMAN_GATE",
  "PROVIDER_UNAVAILABLE",
  "AUTH_FAILURE",
  "MIGRATION_REQUIRED",
  "SECURITY_REQUIRED",
  "REPAIR_LIMIT",
  "BUDGET_EXCEEDED",
  "MAX_STEPS",
  "MAX_AGE",
  "MALFORMED_PROVIDER_OUTPUT",
  "STALE_BASE",
  "OPERATOR_REQUEST",
  "CI_FAILURE_BUDGET",
] as const;

export type CandyBarHumanGateReason = (typeof CANDY_BAR_HUMAN_GATE_REASONS)[number];

export type CandyBarProviderFallbackPolicy = {
  allowOpenAiForArchitect: boolean;
  allowOpenAiForReviewer: boolean;
  allowOpenAiForEngineer: boolean;
};

export type CandyBarWorkflowPolicy = {
  roadmapContext: string | null;
  protectedAreas: string[];
  knownParallelWork: string[];
  nonGoals: string[];
  providerFallbackPolicy: CandyBarProviderFallbackPolicy;
  autoPlanNext: boolean;
  preferredArchitect: CandyBarProviderId;
  preferredReviewer: CandyBarProviderId;
  preferredEngineer: CandyBarProviderId;
  maxStepsPerRun: number;
  maxRepairIterations: number;
  maxReconcileRounds: number;
  maxWallClockMs: number;
  maxProviderFailures: number;
  budgetCents: number | null;
};

export const DEFAULT_CANDY_BAR_WORKFLOW_POLICY: CandyBarWorkflowPolicy = {
  roadmapContext: null,
  protectedAreas: [],
  knownParallelWork: [],
  nonGoals: [],
  providerFallbackPolicy: {
    allowOpenAiForArchitect: false,
    allowOpenAiForReviewer: false,
    allowOpenAiForEngineer: true,
  },
  autoPlanNext: false,
  preferredArchitect: "anthropic",
  preferredReviewer: "xai_grok",
  preferredEngineer: "cursor",
  maxStepsPerRun: 40,
  maxRepairIterations: 3,
  maxReconcileRounds: 2,
  maxWallClockMs: 6 * 60 * 60 * 1000,
  maxProviderFailures: 5,
  budgetCents: null,
};

export type CandyBarWorkflowRecord = {
  id: string;
  tenantId: string;
  operatorUserId: string;
  repository: string;
  currentGoal: string;
  goalVersion: number;
  roadmapContext: string | null;
  protectedAreas: string[];
  knownParallelWork: string[];
  nonGoals: string[];
  providerFallbackPolicy: CandyBarProviderFallbackPolicy;
  autoPlanNext: boolean;
  preferredArchitect: CandyBarProviderId;
  preferredReviewer: CandyBarProviderId;
  preferredEngineer: CandyBarProviderId;
  maxStepsPerRun: number;
  maxRepairIterations: number;
  maxReconcileRounds: number;
  maxWallClockMs: number;
  maxProviderFailures: number;
  budgetCents: number | null;
  updatedAt: string;
  createdAt: string;
};

export type CandyBarGoalSnapshot = {
  workflowId: string;
  goalVersion: number;
  currentGoal: string;
  policy: CandyBarWorkflowPolicy;
};

export type CandyBarRunRecord = {
  id: string;
  tenantId: string;
  operatorUserId: string;
  workflowId: string;
  workflowType: string;
  goalSnapshot: CandyBarGoalSnapshot;
  state: CandyBarRunState;
  authorityLevel: CandyBarAuthorityLevel | null;
  iteration: number;
  repairIteration: number;
  reconcileRound: number;
  stepCount: number;
  providerFailureCount: number;
  estimatedSpendCents: number | null;
  spendKnown: boolean;
  currentStepId: string | null;
  parentRunId: string | null;
  repository: string;
  baseBranch: string;
  baseSha: string | null;
  plannedAgainstSha: string | null;
  candidateBranch: string | null;
  candidatePrNumber: number | null;
  candidatePrUrl: string | null;
  candidateHeadSha: string | null;
  engineerSessionId: string | null;
  blocker: string | null;
  humanGateReason: CandyBarHumanGateReason | null;
  mergeAttempted: boolean;
  deployAttempted: boolean;
  productionMigrationAttempted: boolean;
  nextPlanSpawned: boolean;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  nextRetryAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type CandyBarStepRecord = {
  id: string;
  runId: string;
  kind: CandyBarStepKind;
  status: CandyBarStepStatus;
  attemptNumber: number;
  provider: CandyBarProviderId | null;
  providerSessionId: string | null;
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  error: string | null;
  blocker: string | null;
  requiresHumanApproval: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostCents: number | null;
  costKnown: boolean;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  idempotencyKey: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CandyBarArtifactRecord = {
  id: string;
  runId: string;
  type: CandyBarArtifactType;
  schemaVersion: number;
  producer: string;
  provider: CandyBarProviderId;
  content: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type CandyBarApprovalRecord = {
  id: string;
  runId: string;
  tenantId: string;
  operatorUserId: string;
  action: "approve_continuation" | "cancel" | "retry" | "set_goal" | "start_next";
  reason: string | null;
  actorUserId: string;
  createdAt: string;
};

export type ArchitectPlan = {
  objective: string;
  whyNow: string;
  evidence: string[];
  scope: string[];
  nonGoals: string[];
  likelyFiles: string[];
  dependencies: string[];
  risks: string[];
  proposedAuthorityLevel: CandyBarAuthorityLevel;
  humanGateRequired: boolean;
  proposedEngineer: CandyBarProviderId;
  followOnCandidates: string[];
  implementationBriefDraft: string;
};

export type ReviewCritique = {
  verdict: "ACCEPT" | "ACCEPT_WITH_CHANGES" | "REJECT";
  findings: string[];
  requiredChanges: string[];
  evidence: string[];
  authorityOverride: null | "OBJECTIVE_REDEFINITION" | "HARD_HUMAN_GATE";
  humanDecisionRequired: boolean;
};

export type ReconciledBrief = {
  decision: "ACCEPT" | "ACCEPT_WITH_CHANGES" | "REJECT";
  authorityLevel: CandyBarAuthorityLevel;
  humanGateRequired: boolean;
  humanGateReason: CandyBarHumanGateReason | null;
  implementationBrief: string;
  followOnCandidates: string[];
};

export type AuthorityClassification = {
  level: CandyBarAuthorityLevel;
  rationale: string;
  humanGateReason: CandyBarHumanGateReason | null;
};

export type RepoContextArtifact = {
  repository: string;
  baseBranch: string;
  mainSha: string;
  recentMergedPrs: Array<{ number: number; title: string; mergedAt: string }>;
  openPrs: Array<{ number: number; title: string; headRef: string; draft: boolean }>;
  knownInvariants: string[];
  protectedAreas: string[];
  knownParallelWork: string[];
  nonGoals: string[];
  currentGoal: string;
  goalVersion: number;
  ciSummary: string | null;
};

export type PrStatusArtifact = {
  exists: boolean;
  number: number | null;
  url: string | null;
  state: "open" | "closed" | "merged" | "unknown" | "missing";
  draft: boolean;
  headSha: string | null;
  baseSha: string | null;
  mergeable: boolean | null;
  verified: boolean;
};

export type CiStatusArtifact = {
  headSha: string;
  status: "pending" | "success" | "failure" | "cancelled" | "unknown";
  failedChecks: string[];
  successChecks: string[];
  verified: boolean;
};

export type ProviderDispatchResult =
  | {
      ok: true;
      provider: CandyBarProviderId;
      sessionId: string | null;
      content: Record<string, unknown>;
      inputTokens: number | null;
      outputTokens: number | null;
      estimatedCostCents: number | null;
      costKnown: boolean;
    }
  | {
      ok: false;
      provider: CandyBarProviderId;
      code:
        | "PROVIDER_UNAVAILABLE"
        | "AUTH_FAILURE"
        | "TIMEOUT"
        | "TRANSIENT"
        | "MALFORMED"
        | "NEEDS_HUMAN"
        | "BLOCKED";
      message: string;
      retryable: boolean;
      browserAutomationUsed: false;
    };

/** Explicit transition table. Provider strings never write state directly. */
export const CANDY_BAR_TRANSITIONS: Record<CandyBarRunState, readonly CandyBarRunState[]> = {
  CREATED: ["ASSEMBLING_CONTEXT", "CANCELLED", "BLOCKED"],
  ASSEMBLING_CONTEXT: ["ARCHITECT_RUNNING", "NEEDS_HUMAN", "BLOCKED", "CANCELLED"],
  ARCHITECT_RUNNING: ["ARCHITECT_COMPLETE", "NEEDS_HUMAN", "BLOCKED", "CANCELLED"],
  ARCHITECT_COMPLETE: ["REVIEWER_RUNNING", "NEEDS_HUMAN", "BLOCKED", "CANCELLED"],
  REVIEWER_RUNNING: ["REVIEW_COMPLETE", "NEEDS_HUMAN", "BLOCKED", "CANCELLED"],
  REVIEW_COMPLETE: ["RECONCILING", "NEEDS_HUMAN", "BLOCKED", "CANCELLED"],
  RECONCILING: ["BRIEF_READY", "NEEDS_HUMAN", "BLOCKED", "CANCELLED"],
  BRIEF_READY: ["AUTHORITY_CLASSIFIED", "NEEDS_HUMAN", "BLOCKED", "CANCELLED"],
  AUTHORITY_CLASSIFIED: ["ENGINEER_RUNNING", "NEEDS_HUMAN", "BLOCKED", "CANCELLED"],
  ENGINEER_RUNNING: [
    "PR_OPEN",
    "CI_RUNNING",
    "READY_FOR_HUMAN",
    "NEEDS_HUMAN",
    "BLOCKED",
    "CANCELLED",
  ],
  PR_OPEN: ["CI_RUNNING", "READY_FOR_HUMAN", "NEEDS_HUMAN", "BLOCKED", "CANCELLED"],
  CI_RUNNING: [
    "REPAIR_REQUIRED",
    "READY_FOR_HUMAN",
    "NEEDS_HUMAN",
    "BLOCKED",
    "CANCELLED",
  ],
  REPAIR_REQUIRED: ["ENGINEER_REPAIRING", "NEEDS_HUMAN", "BLOCKED", "CANCELLED"],
  ENGINEER_REPAIRING: ["CI_RUNNING", "NEEDS_HUMAN", "BLOCKED", "CANCELLED"],
  READY_FOR_HUMAN: ["COMPLETED", "CANCELLED"],
  NEEDS_HUMAN: ["CANCELLED", "ASSEMBLING_CONTEXT", "ENGINEER_RUNNING"],
  BLOCKED: ["CANCELLED", "ASSEMBLING_CONTEXT"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionCandyBar(from: CandyBarRunState, to: CandyBarRunState): boolean {
  return (CANDY_BAR_TRANSITIONS[from] ?? []).includes(to);
}

export function parseArchitectPlan(raw: unknown): ArchitectPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.objective !== "string" || !o.objective.trim()) return null;
  if (typeof o.whyNow !== "string") return null;
  if (!Array.isArray(o.evidence) || !Array.isArray(o.scope) || !Array.isArray(o.nonGoals)) {
    return null;
  }
  if (!Array.isArray(o.likelyFiles) || !Array.isArray(o.dependencies) || !Array.isArray(o.risks)) {
    return null;
  }
  if (!CANDY_BAR_AUTHORITY_LEVELS.includes(o.proposedAuthorityLevel as CandyBarAuthorityLevel)) {
    return null;
  }
  if (typeof o.humanGateRequired !== "boolean") return null;
  if (typeof o.implementationBriefDraft !== "string" || !o.implementationBriefDraft.trim()) {
    return null;
  }
  if (!Array.isArray(o.followOnCandidates)) return null;
  const proposedEngineer = (o.proposedEngineer ?? "openai") as CandyBarProviderId;
  if (!CANDY_BAR_PROVIDER_IDS.includes(proposedEngineer)) return null;
  return {
    objective: o.objective.trim(),
    whyNow: String(o.whyNow),
    evidence: o.evidence.map(String),
    scope: o.scope.map(String),
    nonGoals: o.nonGoals.map(String),
    likelyFiles: o.likelyFiles.map(String),
    dependencies: o.dependencies.map(String),
    risks: o.risks.map(String),
    proposedAuthorityLevel: o.proposedAuthorityLevel as CandyBarAuthorityLevel,
    humanGateRequired: o.humanGateRequired,
    proposedEngineer,
    followOnCandidates: o.followOnCandidates.map(String),
    implementationBriefDraft: o.implementationBriefDraft.trim(),
  };
}

export function parseReviewCritique(raw: unknown): ReviewCritique | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.verdict !== "ACCEPT" && o.verdict !== "ACCEPT_WITH_CHANGES" && o.verdict !== "REJECT") {
    return null;
  }
  if (!Array.isArray(o.findings) || !Array.isArray(o.requiredChanges) || !Array.isArray(o.evidence)) {
    return null;
  }
  const override = o.authorityOverride;
  if (
    override !== null &&
    override !== undefined &&
    override !== "OBJECTIVE_REDEFINITION" &&
    override !== "HARD_HUMAN_GATE"
  ) {
    return null;
  }
  if (typeof o.humanDecisionRequired !== "boolean") return null;
  return {
    verdict: o.verdict,
    findings: o.findings.map(String),
    requiredChanges: o.requiredChanges.map(String),
    evidence: o.evidence.map(String),
    authorityOverride: (override ?? null) as ReviewCritique["authorityOverride"],
    humanDecisionRequired: o.humanDecisionRequired,
  };
}

export function assertAllowedCandyBarRepository(repository: string): void {
  if (repository !== CANDY_BAR_ALLOWED_REPOSITORY) {
    throw new Error(`Candy Bar V0 fail-closed: unknown repository ${repository}`);
  }
}

export function authorityAllowsEngineer(level: CandyBarAuthorityLevel): boolean {
  return level === "AUTONOMOUS_EXECUTION" || level === "AUTONOMOUS_PRODUCT_ELABORATION";
}
