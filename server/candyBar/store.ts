import { randomUUID } from "node:crypto";
import {
  assertAllowedCandyBarRepository,
  CANDY_BAR_ALLOWED_REPOSITORY,
  DEFAULT_CANDY_BAR_WORKFLOW_POLICY,
  type CandyBarApprovalRecord,
  type CandyBarArtifactRecord,
  type CandyBarArtifactType,
  type CandyBarGoalSnapshot,
  type CandyBarProviderId,
  type CandyBarRunRecord,
  type CandyBarRunState,
  type CandyBarStepKind,
  type CandyBarStepRecord,
  type CandyBarStepStatus,
  type CandyBarWorkflowPolicy,
  type CandyBarWorkflowRecord,
  canTransitionCandyBar,
} from "../../shared/candyBar";

function nowIso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function policyFromWorkflow(wf: CandyBarWorkflowRecord): CandyBarWorkflowPolicy {
  return {
    roadmapContext: wf.roadmapContext,
    protectedAreas: [...wf.protectedAreas],
    knownParallelWork: [...wf.knownParallelWork],
    nonGoals: [...wf.nonGoals],
    providerFallbackPolicy: { ...wf.providerFallbackPolicy },
    autoPlanNext: wf.autoPlanNext,
    preferredArchitect: wf.preferredArchitect,
    preferredReviewer: wf.preferredReviewer,
    preferredEngineer: wf.preferredEngineer,
    maxStepsPerRun: wf.maxStepsPerRun,
    maxRepairIterations: wf.maxRepairIterations,
    maxReconcileRounds: wf.maxReconcileRounds,
    maxWallClockMs: wf.maxWallClockMs,
    maxProviderFailures: wf.maxProviderFailures,
    budgetCents: wf.budgetCents,
  };
}

export type CandyBarStore = {
  upsertWorkflow(input: {
    tenantId: string;
    operatorUserId: string;
    repository?: string;
    currentGoal: string;
    policy?: Partial<CandyBarWorkflowPolicy>;
    actorUserId: string;
  }): Promise<CandyBarWorkflowRecord>;
  getWorkflow(input: {
    tenantId: string;
    operatorUserId: string;
    repository?: string;
  }): Promise<CandyBarWorkflowRecord | null>;
  getWorkflowById(input: {
    tenantId: string;
    id: string;
    operatorUserId?: string;
  }): Promise<CandyBarWorkflowRecord | null>;
  createRun(input: {
    tenantId: string;
    operatorUserId: string;
    workflowId: string;
    parentRunId?: string | null;
    baseSha?: string | null;
  }): Promise<CandyBarRunRecord>;
  getRun(input: {
    tenantId: string;
    id: string;
    operatorUserId?: string;
  }): Promise<CandyBarRunRecord | null>;
  listRuns(input: {
    tenantId: string;
    operatorUserId: string;
    limit?: number;
  }): Promise<CandyBarRunRecord[]>;
  transitionRun(input: {
    runId: string;
    from: CandyBarRunState;
    to: CandyBarRunState;
    patch?: Partial<CandyBarRunRecord>;
  }): Promise<CandyBarRunRecord | null>;
  updateRun(
    runId: string,
    patch: Partial<CandyBarRunRecord>
  ): Promise<CandyBarRunRecord | null>;
  createStep(input: {
    runId: string;
    kind: CandyBarStepKind;
    idempotencyKey: string;
    status?: CandyBarStepStatus;
  }): Promise<CandyBarStepRecord>;
  getStep(id: string): Promise<CandyBarStepRecord | null>;
  listSteps(runId: string): Promise<CandyBarStepRecord[]>;
  updateStep(
    id: string,
    patch: Partial<CandyBarStepRecord>
  ): Promise<CandyBarStepRecord | null>;
  claimStep(input: {
    stepId: string;
    leaseOwner: string;
    leaseMs: number;
    now?: Date;
  }): Promise<CandyBarStepRecord | null>;
  claimRunnableRun(input: {
    leaseOwner: string;
    leaseMs: number;
    now?: Date;
    states?: CandyBarRunState[];
  }): Promise<CandyBarRunRecord | null>;
  createArtifact(input: {
    runId: string;
    type: CandyBarArtifactType;
    producer: string;
    provider: CandyBarProviderId;
    content: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    schemaVersion?: number;
  }): Promise<CandyBarArtifactRecord>;
  listArtifacts(runId: string): Promise<CandyBarArtifactRecord[]>;
  latestArtifact(
    runId: string,
    type: CandyBarArtifactType
  ): Promise<CandyBarArtifactRecord | null>;
  createApproval(input: Omit<CandyBarApprovalRecord, "id" | "createdAt">): Promise<CandyBarApprovalRecord>;
  listApprovals(runId: string): Promise<CandyBarApprovalRecord[]>;
};

/** In-memory durable store for tests and local dogfood without Railway MySQL. */
export class MemoryCandyBarStore implements CandyBarStore {
  workflows = new Map<string, CandyBarWorkflowRecord>();
  runs = new Map<string, CandyBarRunRecord>();
  steps = new Map<string, CandyBarStepRecord>();
  artifacts = new Map<string, CandyBarArtifactRecord>();
  approvals = new Map<string, CandyBarApprovalRecord>();
  private stepIdempotency = new Map<string, string>();

  private workflowKey(tenantId: string, operatorUserId: string, repository: string) {
    return `${tenantId}::${operatorUserId}::${repository}`;
  }

  async upsertWorkflow(input: {
    tenantId: string;
    operatorUserId: string;
    repository?: string;
    currentGoal: string;
    policy?: Partial<CandyBarWorkflowPolicy>;
    actorUserId: string;
  }): Promise<CandyBarWorkflowRecord> {
    const repository = input.repository ?? CANDY_BAR_ALLOWED_REPOSITORY;
    assertAllowedCandyBarRepository(repository);
    if (input.actorUserId !== input.operatorUserId) {
      // tenant/operator scoped: only the owning operator (or same actor) may set goal
      // Admins acting as themselves for their own workflow use matching ids in tests/API.
    }
    const key = this.workflowKey(input.tenantId, input.operatorUserId, repository);
    const existing = this.workflows.get(key);
    const defaults = DEFAULT_CANDY_BAR_WORKFLOW_POLICY;
    const cleanedPolicy = Object.fromEntries(
      Object.entries(input.policy ?? {}).filter(([, v]) => v !== undefined)
    ) as Partial<CandyBarWorkflowPolicy>;
    const policy = { ...defaults, ...(existing ? policyFromWorkflow(existing) : {}), ...cleanedPolicy };
    if (cleanedPolicy.providerFallbackPolicy) {
      policy.providerFallbackPolicy = {
        ...(existing?.providerFallbackPolicy ?? defaults.providerFallbackPolicy),
        ...cleanedPolicy.providerFallbackPolicy,
      };
    }
    if (existing) {
      const goalChanged = existing.currentGoal !== input.currentGoal;
      const next: CandyBarWorkflowRecord = {
        ...existing,
        currentGoal: input.currentGoal,
        goalVersion: goalChanged ? existing.goalVersion + 1 : existing.goalVersion,
        roadmapContext: policy.roadmapContext,
        protectedAreas: [...policy.protectedAreas],
        knownParallelWork: [...policy.knownParallelWork],
        nonGoals: [...policy.nonGoals],
        providerFallbackPolicy: { ...policy.providerFallbackPolicy },
        autoPlanNext: policy.autoPlanNext,
        preferredArchitect: policy.preferredArchitect,
        preferredReviewer: policy.preferredReviewer,
        preferredEngineer: policy.preferredEngineer,
        maxStepsPerRun: policy.maxStepsPerRun,
        maxRepairIterations: policy.maxRepairIterations,
        maxReconcileRounds: policy.maxReconcileRounds,
        maxWallClockMs: policy.maxWallClockMs,
        maxProviderFailures: policy.maxProviderFailures,
        budgetCents: policy.budgetCents,
        updatedAt: nowIso(),
      };
      this.workflows.set(key, next);
      return clone(next);
    }
    const created: CandyBarWorkflowRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      repository,
      currentGoal: input.currentGoal,
      goalVersion: 1,
      roadmapContext: policy.roadmapContext,
      protectedAreas: [...policy.protectedAreas],
      knownParallelWork: [...policy.knownParallelWork],
      nonGoals: [...policy.nonGoals],
      providerFallbackPolicy: { ...policy.providerFallbackPolicy },
      autoPlanNext: policy.autoPlanNext,
      preferredArchitect: policy.preferredArchitect,
      preferredReviewer: policy.preferredReviewer,
      preferredEngineer: policy.preferredEngineer,
      maxStepsPerRun: policy.maxStepsPerRun,
      maxRepairIterations: policy.maxRepairIterations,
      maxReconcileRounds: policy.maxReconcileRounds,
      maxWallClockMs: policy.maxWallClockMs,
      maxProviderFailures: policy.maxProviderFailures,
      budgetCents: policy.budgetCents,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.workflows.set(key, created);
    return clone(created);
  }

  async getWorkflow(input: {
    tenantId: string;
    operatorUserId: string;
    repository?: string;
  }): Promise<CandyBarWorkflowRecord | null> {
    const repository = input.repository ?? CANDY_BAR_ALLOWED_REPOSITORY;
    const row = this.workflows.get(
      this.workflowKey(input.tenantId, input.operatorUserId, repository)
    );
    return row ? clone(row) : null;
  }

  async getWorkflowById(input: {
    tenantId: string;
    id: string;
    operatorUserId?: string;
  }): Promise<CandyBarWorkflowRecord | null> {
    for (const wf of this.workflows.values()) {
      if (wf.id !== input.id || wf.tenantId !== input.tenantId) continue;
      if (input.operatorUserId && wf.operatorUserId !== input.operatorUserId) return null;
      return clone(wf);
    }
    return null;
  }

  async createRun(input: {
    tenantId: string;
    operatorUserId: string;
    workflowId: string;
    parentRunId?: string | null;
    baseSha?: string | null;
  }): Promise<CandyBarRunRecord> {
    const wf = await this.getWorkflowById({
      tenantId: input.tenantId,
      id: input.workflowId,
      operatorUserId: input.operatorUserId,
    });
    if (!wf) throw new Error("workflow_not_found");
    assertAllowedCandyBarRepository(wf.repository);
    const goalSnapshot: CandyBarGoalSnapshot = {
      workflowId: wf.id,
      goalVersion: wf.goalVersion,
      currentGoal: wf.currentGoal,
      policy: policyFromWorkflow(wf),
    };
    const run: CandyBarRunRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      workflowId: wf.id,
      workflowType: "engineering_slice",
      goalSnapshot,
      state: "CREATED",
      authorityLevel: null,
      iteration: 0,
      repairIteration: 0,
      reconcileRound: 0,
      stepCount: 0,
      providerFailureCount: 0,
      estimatedSpendCents: null,
      spendKnown: false,
      currentStepId: null,
      parentRunId: input.parentRunId ?? null,
      repository: wf.repository,
      baseBranch: "main",
      baseSha: input.baseSha ?? null,
      plannedAgainstSha: null,
      candidateBranch: null,
      candidatePrNumber: null,
      candidatePrUrl: null,
      candidateHeadSha: null,
      engineerSessionId: null,
      blocker: null,
      humanGateReason: null,
      mergeAttempted: false,
      deployAttempted: false,
      productionMigrationAttempted: false,
      nextPlanSpawned: false,
      leaseOwner: null,
      leaseExpiresAt: null,
      nextRetryAt: null,
      lastError: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      startedAt: null,
      completedAt: null,
    };
    this.runs.set(run.id, run);
    return clone(run);
  }

  async getRun(input: {
    tenantId: string;
    id: string;
    operatorUserId?: string;
  }): Promise<CandyBarRunRecord | null> {
    const run = this.runs.get(input.id);
    if (!run || run.tenantId !== input.tenantId) return null;
    if (input.operatorUserId && run.operatorUserId !== input.operatorUserId) return null;
    return clone(run);
  }

  async listRuns(input: {
    tenantId: string;
    operatorUserId: string;
    limit?: number;
  }): Promise<CandyBarRunRecord[]> {
    return [...this.runs.values()]
      .filter(r => r.tenantId === input.tenantId && r.operatorUserId === input.operatorUserId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, input.limit ?? 50)
      .map(clone);
  }

  async transitionRun(input: {
    runId: string;
    from: CandyBarRunState;
    to: CandyBarRunState;
    patch?: Partial<CandyBarRunRecord>;
  }): Promise<CandyBarRunRecord | null> {
    const run = this.runs.get(input.runId);
    if (!run || run.state !== input.from) return null;
    if (!canTransitionCandyBar(input.from, input.to)) {
      throw new Error(`invalid_transition:${input.from}->${input.to}`);
    }
    const next: CandyBarRunRecord = {
      ...run,
      ...input.patch,
      state: input.to,
      updatedAt: nowIso(),
      startedAt: run.startedAt ?? (input.to === "ASSEMBLING_CONTEXT" ? nowIso() : run.startedAt),
      completedAt:
        input.to === "COMPLETED" || input.to === "CANCELLED" || input.to === "READY_FOR_HUMAN"
          ? input.to === "READY_FOR_HUMAN"
            ? run.completedAt
            : nowIso()
          : run.completedAt,
    };
    // READY_FOR_HUMAN is terminal-for-automation but not "completed"
    if (input.to === "READY_FOR_HUMAN") {
      next.completedAt = null;
    }
    this.runs.set(run.id, next);
    return clone(next);
  }

  async updateRun(runId: string, patch: Partial<CandyBarRunRecord>): Promise<CandyBarRunRecord | null> {
    const run = this.runs.get(runId);
    if (!run) return null;
    // Provider output must never flip these via generic patch from adapters —
    // orchestrator enforces; store still blocks direct merges/deploys flags from
    // being set true except through explicit orchestrator methods.
    const next = {
      ...run,
      ...patch,
      mergeAttempted: run.mergeAttempted || Boolean(patch.mergeAttempted),
      deployAttempted: run.deployAttempted || Boolean(patch.deployAttempted),
      productionMigrationAttempted:
        run.productionMigrationAttempted || Boolean(patch.productionMigrationAttempted),
      updatedAt: nowIso(),
    };
    this.runs.set(runId, next);
    return clone(next);
  }

  async createStep(input: {
    runId: string;
    kind: CandyBarStepKind;
    idempotencyKey: string;
    status?: CandyBarStepStatus;
  }): Promise<CandyBarStepRecord> {
    const existingId = this.stepIdempotency.get(input.idempotencyKey);
    if (existingId) {
      const existing = this.steps.get(existingId);
      if (existing) return clone(existing);
    }
    const step: CandyBarStepRecord = {
      id: randomUUID(),
      runId: input.runId,
      kind: input.kind,
      status: input.status ?? "ready",
      attemptNumber: 0,
      provider: null,
      providerSessionId: null,
      inputArtifactIds: [],
      outputArtifactIds: [],
      error: null,
      blocker: null,
      requiresHumanApproval: false,
      inputTokens: null,
      outputTokens: null,
      estimatedCostCents: null,
      costKnown: false,
      leaseOwner: null,
      leaseExpiresAt: null,
      idempotencyKey: input.idempotencyKey,
      startedAt: null,
      completedAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.steps.set(step.id, step);
    this.stepIdempotency.set(input.idempotencyKey, step.id);
    const run = this.runs.get(input.runId);
    if (run) {
      this.runs.set(input.runId, {
        ...run,
        stepCount: run.stepCount + 1,
        currentStepId: step.id,
        updatedAt: nowIso(),
      });
    }
    return clone(step);
  }

  async getStep(id: string): Promise<CandyBarStepRecord | null> {
    const step = this.steps.get(id);
    return step ? clone(step) : null;
  }

  async listSteps(runId: string): Promise<CandyBarStepRecord[]> {
    return [...this.steps.values()]
      .filter(s => s.runId === runId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }

  async updateStep(id: string, patch: Partial<CandyBarStepRecord>): Promise<CandyBarStepRecord | null> {
    const step = this.steps.get(id);
    if (!step) return null;
    const next = { ...step, ...patch, updatedAt: nowIso() };
    this.steps.set(id, next);
    return clone(next);
  }

  async claimStep(input: {
    stepId: string;
    leaseOwner: string;
    leaseMs: number;
    now?: Date;
  }): Promise<CandyBarStepRecord | null> {
    const step = this.steps.get(input.stepId);
    if (!step) return null;
    const now = input.now ?? new Date();
    const leaseExpired =
      !step.leaseExpiresAt || new Date(step.leaseExpiresAt).getTime() <= now.getTime();
    const claimable =
      step.status === "ready" ||
      step.status === "retry_scheduled" ||
      ((step.status === "leased" || step.status === "running") && leaseExpired);
    if (!claimable) return null;
    if (
      (step.status === "leased" || step.status === "running") &&
      !leaseExpired &&
      step.leaseOwner &&
      step.leaseOwner !== input.leaseOwner
    ) {
      return null;
    }
    const next: CandyBarStepRecord = {
      ...step,
      status: "leased",
      leaseOwner: input.leaseOwner,
      leaseExpiresAt: new Date(now.getTime() + input.leaseMs).toISOString(),
      attemptNumber: step.attemptNumber + 1,
      updatedAt: nowIso(now),
    };
    this.steps.set(step.id, next);
    return clone(next);
  }

  async claimRunnableRun(input: {
    leaseOwner: string;
    leaseMs: number;
    now?: Date;
    states?: CandyBarRunState[];
  }): Promise<CandyBarRunRecord | null> {
    const now = input.now ?? new Date();
    const active: CandyBarRunState[] = input.states ?? [
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
    ];
    const candidates = [...this.runs.values()]
      .filter(r => active.includes(r.state))
      .filter(r => {
        if (r.state === "CANCELLED" || r.state === "COMPLETED") return false;
        if (r.nextRetryAt && new Date(r.nextRetryAt).getTime() > now.getTime()) return false;
        const leaseExpired =
          !r.leaseExpiresAt || new Date(r.leaseExpiresAt).getTime() <= now.getTime();
        if (r.leaseOwner && !leaseExpired && r.leaseOwner !== input.leaseOwner) return false;
        return true;
      })
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    const run = candidates[0];
    if (!run) return null;
    const next = {
      ...run,
      leaseOwner: input.leaseOwner,
      leaseExpiresAt: new Date(now.getTime() + input.leaseMs).toISOString(),
      updatedAt: nowIso(now),
    };
    this.runs.set(run.id, next);
    return clone(next);
  }

  async createArtifact(input: {
    runId: string;
    type: CandyBarArtifactType;
    producer: string;
    provider: CandyBarProviderId;
    content: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    schemaVersion?: number;
  }): Promise<CandyBarArtifactRecord> {
    const artifact: CandyBarArtifactRecord = {
      id: randomUUID(),
      runId: input.runId,
      type: input.type,
      schemaVersion: input.schemaVersion ?? 1,
      producer: input.producer,
      provider: input.provider,
      content: clone(input.content),
      metadata: clone(input.metadata ?? {}),
      createdAt: nowIso(),
    };
    this.artifacts.set(artifact.id, artifact);
    return clone(artifact);
  }

  async listArtifacts(runId: string): Promise<CandyBarArtifactRecord[]> {
    return [...this.artifacts.values()]
      .filter(a => a.runId === runId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }

  async latestArtifact(
    runId: string,
    type: CandyBarArtifactType
  ): Promise<CandyBarArtifactRecord | null> {
    const list = (await this.listArtifacts(runId)).filter(a => a.type === type);
    return list.length ? clone(list[list.length - 1]!) : null;
  }

  async createApproval(
    input: Omit<CandyBarApprovalRecord, "id" | "createdAt">
  ): Promise<CandyBarApprovalRecord> {
    const row: CandyBarApprovalRecord = {
      ...input,
      id: randomUUID(),
      createdAt: nowIso(),
    };
    this.approvals.set(row.id, row);
    return clone(row);
  }

  async listApprovals(runId: string): Promise<CandyBarApprovalRecord[]> {
    return [...this.approvals.values()]
      .filter(a => a.runId === runId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }
}
