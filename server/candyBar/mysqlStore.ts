import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { isMysqlDuplicateKeyError, isMysqlMissingTableError } from "../mysqlErrors";
import {
  assertAllowedCandyBarRepository,
  CANDY_BAR_ALLOWED_REPOSITORY,
  DEFAULT_CANDY_BAR_WORKFLOW_POLICY,
  type CandyBarApprovalRecord,
  type CandyBarArtifactRecord,
  type CandyBarArtifactType,
  type CandyBarAuthorityLevel,
  type CandyBarGoalSnapshot,
  type CandyBarHumanGateReason,
  type CandyBarProviderFallbackPolicy,
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
import {
  candyBarApprovals,
  candyBarArtifacts,
  candyBarRuns,
  candyBarSteps,
  candyBarWorkflows,
} from "./schema";
import type { CandyBarStore } from "./store";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export class CandyBarSchemaBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CandyBarSchemaBlockedError";
  }
}

function nowIso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  return new Date(iso);
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function toIsoRequired(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String);
}

function asJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asProviderFallback(value: unknown): CandyBarProviderFallbackPolicy {
  const o = asJsonObject(value);
  return {
    allowOpenAiForArchitect: Boolean(o.allowOpenAiForArchitect),
    allowOpenAiForReviewer: Boolean(o.allowOpenAiForReviewer),
    allowOpenAiForEngineer: Boolean(o.allowOpenAiForEngineer ?? true),
  };
}

function asGoalSnapshot(value: unknown): CandyBarGoalSnapshot {
  const o = asJsonObject(value);
  const policyRaw = asJsonObject(o.policy);
  const defaults = DEFAULT_CANDY_BAR_WORKFLOW_POLICY;
  const policy: CandyBarWorkflowPolicy = {
    roadmapContext:
      typeof policyRaw.roadmapContext === "string" || policyRaw.roadmapContext === null
        ? (policyRaw.roadmapContext as string | null)
        : defaults.roadmapContext,
    protectedAreas: asStringArray(policyRaw.protectedAreas),
    knownParallelWork: asStringArray(policyRaw.knownParallelWork),
    nonGoals: asStringArray(policyRaw.nonGoals),
    providerFallbackPolicy: asProviderFallback(
      policyRaw.providerFallbackPolicy ?? defaults.providerFallbackPolicy
    ),
    autoPlanNext: Boolean(policyRaw.autoPlanNext ?? defaults.autoPlanNext),
    preferredArchitect: (policyRaw.preferredArchitect as CandyBarProviderId) ?? defaults.preferredArchitect,
    preferredReviewer: (policyRaw.preferredReviewer as CandyBarProviderId) ?? defaults.preferredReviewer,
    preferredEngineer: (policyRaw.preferredEngineer as CandyBarProviderId) ?? defaults.preferredEngineer,
    maxStepsPerRun: Number(policyRaw.maxStepsPerRun ?? defaults.maxStepsPerRun),
    maxRepairIterations: Number(policyRaw.maxRepairIterations ?? defaults.maxRepairIterations),
    maxReconcileRounds: Number(policyRaw.maxReconcileRounds ?? defaults.maxReconcileRounds),
    maxWallClockMs: Number(policyRaw.maxWallClockMs ?? defaults.maxWallClockMs),
    maxProviderFailures: Number(policyRaw.maxProviderFailures ?? defaults.maxProviderFailures),
    budgetCents:
      policyRaw.budgetCents == null ? null : Number(policyRaw.budgetCents),
  };
  return {
    workflowId: String(o.workflowId ?? ""),
    goalVersion: Number(o.goalVersion ?? 1),
    currentGoal: String(o.currentGoal ?? ""),
    policy,
  };
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

function mapWorkflowRow(row: typeof candyBarWorkflows.$inferSelect): CandyBarWorkflowRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    operatorUserId: row.operatorUserId,
    repository: row.repository,
    currentGoal: row.currentGoal,
    goalVersion: row.goalVersion,
    roadmapContext: row.roadmapContext ?? null,
    protectedAreas: asStringArray(row.protectedAreasJson),
    knownParallelWork: asStringArray(row.knownParallelWorkJson),
    nonGoals: asStringArray(row.nonGoalsJson),
    providerFallbackPolicy: asProviderFallback(row.providerFallbackPolicyJson),
    autoPlanNext: Boolean(row.autoPlanNext),
    preferredArchitect: row.preferredArchitect as CandyBarProviderId,
    preferredReviewer: row.preferredReviewer as CandyBarProviderId,
    preferredEngineer: row.preferredEngineer as CandyBarProviderId,
    maxStepsPerRun: row.maxStepsPerRun,
    maxRepairIterations: row.maxRepairIterations,
    maxReconcileRounds: row.maxReconcileRounds,
    maxWallClockMs: row.maxWallClockMs,
    maxProviderFailures: row.maxProviderFailures,
    budgetCents: row.budgetCents ?? null,
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  };
}

function mapRunRow(row: typeof candyBarRuns.$inferSelect): CandyBarRunRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    operatorUserId: row.operatorUserId,
    workflowId: row.workflowId,
    workflowType: row.workflowType,
    goalSnapshot: asGoalSnapshot(row.goalSnapshotJson),
    state: row.state as CandyBarRunState,
    authorityLevel: (row.authorityLevel as CandyBarAuthorityLevel | null) ?? null,
    iteration: row.iteration,
    repairIteration: row.repairIteration,
    reconcileRound: row.reconcileRound,
    stepCount: row.stepCount,
    providerFailureCount: row.providerFailureCount,
    estimatedSpendCents: row.estimatedSpendCents ?? null,
    spendKnown: Boolean(row.spendKnown),
    currentStepId: row.currentStepId ?? null,
    parentRunId: row.parentRunId ?? null,
    repository: row.repository,
    baseBranch: row.baseBranch,
    baseSha: row.baseSha ?? null,
    plannedAgainstSha: row.plannedAgainstSha ?? null,
    candidateBranch: row.candidateBranch ?? null,
    candidatePrNumber: row.candidatePrNumber ?? null,
    candidatePrUrl: row.candidatePrUrl ?? null,
    candidateHeadSha: row.candidateHeadSha ?? null,
    engineerSessionId: row.engineerSessionId ?? null,
    blocker: row.blocker ?? null,
    humanGateReason: (row.humanGateReason as CandyBarHumanGateReason | null) ?? null,
    mergeAttempted: Boolean(row.mergeAttempted),
    deployAttempted: Boolean(row.deployAttempted),
    productionMigrationAttempted: Boolean(row.productionMigrationAttempted),
    nextPlanSpawned: Boolean(row.nextPlanSpawned),
    leaseOwner: row.leaseOwner ?? null,
    leaseExpiresAt: toIso(row.leaseExpiresAt),
    nextRetryAt: toIso(row.nextRetryAt),
    lastError: row.lastError ?? null,
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
    startedAt: toIso(row.startedAt),
    completedAt: toIso(row.completedAt),
  };
}

function mapStepRow(row: typeof candyBarSteps.$inferSelect): CandyBarStepRecord {
  return {
    id: row.id,
    runId: row.runId,
    kind: row.kind as CandyBarStepKind,
    status: row.status as CandyBarStepStatus,
    attemptNumber: row.attemptNumber,
    provider: (row.provider as CandyBarProviderId | null) ?? null,
    providerSessionId: row.providerSessionId ?? null,
    inputArtifactIds: asStringArray(row.inputArtifactIdsJson),
    outputArtifactIds: asStringArray(row.outputArtifactIdsJson),
    error: row.error ?? null,
    blocker: row.blocker ?? null,
    requiresHumanApproval: Boolean(row.requiresHumanApproval),
    inputTokens: row.inputTokens ?? null,
    outputTokens: row.outputTokens ?? null,
    estimatedCostCents: row.estimatedCostCents ?? null,
    costKnown: Boolean(row.costKnown),
    leaseOwner: row.leaseOwner ?? null,
    leaseExpiresAt: toIso(row.leaseExpiresAt),
    idempotencyKey: row.idempotencyKey,
    startedAt: toIso(row.startedAt),
    completedAt: toIso(row.completedAt),
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  };
}

function mapArtifactRow(row: typeof candyBarArtifacts.$inferSelect): CandyBarArtifactRecord {
  return {
    id: row.id,
    runId: row.runId,
    type: row.type as CandyBarArtifactType,
    schemaVersion: row.schemaVersion,
    producer: row.producer,
    provider: row.provider as CandyBarProviderId,
    content: asJsonObject(row.contentJson),
    metadata: asJsonObject(row.metadataJson),
    createdAt: toIsoRequired(row.createdAt),
  };
}

function mapApprovalRow(row: typeof candyBarApprovals.$inferSelect): CandyBarApprovalRecord {
  return {
    id: row.id,
    runId: row.runId,
    tenantId: row.tenantId,
    operatorUserId: row.operatorUserId,
    action: row.action as CandyBarApprovalRecord["action"],
    reason: row.reason ?? null,
    actorUserId: row.actorUserId,
    createdAt: toIsoRequired(row.createdAt),
  };
}

function runRecordToDbPatch(patch: Partial<CandyBarRunRecord>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.tenantId !== undefined) out.tenantId = patch.tenantId;
  if (patch.operatorUserId !== undefined) out.operatorUserId = patch.operatorUserId;
  if (patch.workflowId !== undefined) out.workflowId = patch.workflowId;
  if (patch.workflowType !== undefined) out.workflowType = patch.workflowType;
  if (patch.goalSnapshot !== undefined) out.goalSnapshotJson = patch.goalSnapshot;
  if (patch.state !== undefined) out.state = patch.state;
  if (patch.authorityLevel !== undefined) out.authorityLevel = patch.authorityLevel;
  if (patch.iteration !== undefined) out.iteration = patch.iteration;
  if (patch.repairIteration !== undefined) out.repairIteration = patch.repairIteration;
  if (patch.reconcileRound !== undefined) out.reconcileRound = patch.reconcileRound;
  if (patch.stepCount !== undefined) out.stepCount = patch.stepCount;
  if (patch.providerFailureCount !== undefined) out.providerFailureCount = patch.providerFailureCount;
  if (patch.estimatedSpendCents !== undefined) out.estimatedSpendCents = patch.estimatedSpendCents;
  if (patch.spendKnown !== undefined) out.spendKnown = patch.spendKnown;
  if (patch.currentStepId !== undefined) out.currentStepId = patch.currentStepId;
  if (patch.parentRunId !== undefined) out.parentRunId = patch.parentRunId;
  if (patch.repository !== undefined) out.repository = patch.repository;
  if (patch.baseBranch !== undefined) out.baseBranch = patch.baseBranch;
  if (patch.baseSha !== undefined) out.baseSha = patch.baseSha;
  if (patch.plannedAgainstSha !== undefined) out.plannedAgainstSha = patch.plannedAgainstSha;
  if (patch.candidateBranch !== undefined) out.candidateBranch = patch.candidateBranch;
  if (patch.candidatePrNumber !== undefined) out.candidatePrNumber = patch.candidatePrNumber;
  if (patch.candidatePrUrl !== undefined) out.candidatePrUrl = patch.candidatePrUrl;
  if (patch.candidateHeadSha !== undefined) out.candidateHeadSha = patch.candidateHeadSha;
  if (patch.engineerSessionId !== undefined) out.engineerSessionId = patch.engineerSessionId;
  if (patch.blocker !== undefined) out.blocker = patch.blocker;
  if (patch.humanGateReason !== undefined) out.humanGateReason = patch.humanGateReason;
  if (patch.mergeAttempted !== undefined) out.mergeAttempted = patch.mergeAttempted;
  if (patch.deployAttempted !== undefined) out.deployAttempted = patch.deployAttempted;
  if (patch.productionMigrationAttempted !== undefined) {
    out.productionMigrationAttempted = patch.productionMigrationAttempted;
  }
  if (patch.nextPlanSpawned !== undefined) out.nextPlanSpawned = patch.nextPlanSpawned;
  if (patch.leaseOwner !== undefined) out.leaseOwner = patch.leaseOwner;
  if (patch.leaseExpiresAt !== undefined) out.leaseExpiresAt = toDate(patch.leaseExpiresAt);
  if (patch.nextRetryAt !== undefined) out.nextRetryAt = toDate(patch.nextRetryAt);
  if (patch.lastError !== undefined) out.lastError = patch.lastError;
  if (patch.startedAt !== undefined) out.startedAt = toDate(patch.startedAt);
  if (patch.completedAt !== undefined) out.completedAt = toDate(patch.completedAt);
  if (patch.createdAt !== undefined) out.createdAt = toDate(patch.createdAt);
  if (patch.updatedAt !== undefined) out.updatedAt = toDate(patch.updatedAt);
  return out;
}

function stepRecordToDbPatch(patch: Partial<CandyBarStepRecord>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.runId !== undefined) out.runId = patch.runId;
  if (patch.kind !== undefined) out.kind = patch.kind;
  if (patch.status !== undefined) out.status = patch.status;
  if (patch.attemptNumber !== undefined) out.attemptNumber = patch.attemptNumber;
  if (patch.provider !== undefined) out.provider = patch.provider;
  if (patch.providerSessionId !== undefined) out.providerSessionId = patch.providerSessionId;
  if (patch.inputArtifactIds !== undefined) out.inputArtifactIdsJson = patch.inputArtifactIds;
  if (patch.outputArtifactIds !== undefined) out.outputArtifactIdsJson = patch.outputArtifactIds;
  if (patch.error !== undefined) out.error = patch.error;
  if (patch.blocker !== undefined) out.blocker = patch.blocker;
  if (patch.requiresHumanApproval !== undefined) out.requiresHumanApproval = patch.requiresHumanApproval;
  if (patch.inputTokens !== undefined) out.inputTokens = patch.inputTokens;
  if (patch.outputTokens !== undefined) out.outputTokens = patch.outputTokens;
  if (patch.estimatedCostCents !== undefined) out.estimatedCostCents = patch.estimatedCostCents;
  if (patch.costKnown !== undefined) out.costKnown = patch.costKnown;
  if (patch.leaseOwner !== undefined) out.leaseOwner = patch.leaseOwner;
  if (patch.leaseExpiresAt !== undefined) out.leaseExpiresAt = toDate(patch.leaseExpiresAt);
  if (patch.idempotencyKey !== undefined) out.idempotencyKey = patch.idempotencyKey;
  if (patch.startedAt !== undefined) out.startedAt = toDate(patch.startedAt);
  if (patch.completedAt !== undefined) out.completedAt = toDate(patch.completedAt);
  if (patch.createdAt !== undefined) out.createdAt = toDate(patch.createdAt);
  if (patch.updatedAt !== undefined) out.updatedAt = toDate(patch.updatedAt);
  return out;
}

/**
 * Production MySQL CandyBarStore. Fail-closed when db/tables missing.
 * Never falls back to memory.
 */
export class MysqlCandyBarStore implements CandyBarStore {
  constructor(private readonly dbProvider: () => Promise<Db | null> = getDb) {}

  private async requireDb(): Promise<Db> {
    const db = await this.dbProvider();
    if (!db) {
      const err = new Error("Database not available");
      err.name = "CandyBarSchemaBlockedError";
      throw err;
    }
    return db;
  }

  private rethrowSchemaBlocked(error: unknown): never {
    if (isMysqlMissingTableError(error)) {
      throw new CandyBarSchemaBlockedError("candy_bar tables are not present");
    }
    throw error;
  }

  private async withSchemaGuard<T>(op: (db: Db) => Promise<T>): Promise<T> {
    const db = await this.requireDb();
    try {
      return await op(db);
    } catch (error) {
      this.rethrowSchemaBlocked(error);
    }
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
    return this.withSchemaGuard(async db => {
      const existing = await this.getWorkflow({
        tenantId: input.tenantId,
        operatorUserId: input.operatorUserId,
        repository,
      });
      const defaults = DEFAULT_CANDY_BAR_WORKFLOW_POLICY;
      const cleanedPolicy = Object.fromEntries(
        Object.entries(input.policy ?? {}).filter(([, v]) => v !== undefined)
      ) as Partial<CandyBarWorkflowPolicy>;
      const policy = {
        ...defaults,
        ...(existing ? policyFromWorkflow(existing) : {}),
        ...cleanedPolicy,
      };
      if (cleanedPolicy.providerFallbackPolicy) {
        policy.providerFallbackPolicy = {
          ...(existing?.providerFallbackPolicy ?? defaults.providerFallbackPolicy),
          ...cleanedPolicy.providerFallbackPolicy,
        };
      }
      const now = new Date();
      if (existing) {
        const goalChanged = existing.currentGoal !== input.currentGoal;
        await db
          .update(candyBarWorkflows)
          .set({
            currentGoal: input.currentGoal,
            goalVersion: goalChanged ? existing.goalVersion + 1 : existing.goalVersion,
            roadmapContext: policy.roadmapContext,
            protectedAreasJson: [...policy.protectedAreas],
            knownParallelWorkJson: [...policy.knownParallelWork],
            nonGoalsJson: [...policy.nonGoals],
            providerFallbackPolicyJson: { ...policy.providerFallbackPolicy },
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
            updatedAt: now,
          })
          .where(eq(candyBarWorkflows.id, existing.id));
        const next = await this.getWorkflowById({
          tenantId: input.tenantId,
          id: existing.id,
        });
        if (!next) throw new Error("workflow_update_missing");
        return next;
      }
      const id = randomUUID();
      await db.insert(candyBarWorkflows).values({
        id,
        tenantId: input.tenantId,
        operatorUserId: input.operatorUserId,
        repository,
        currentGoal: input.currentGoal,
        goalVersion: 1,
        roadmapContext: policy.roadmapContext,
        protectedAreasJson: [...policy.protectedAreas],
        knownParallelWorkJson: [...policy.knownParallelWork],
        nonGoalsJson: [...policy.nonGoals],
        providerFallbackPolicyJson: { ...policy.providerFallbackPolicy },
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
        createdAt: now,
        updatedAt: now,
      });
      const created = await this.getWorkflowById({
        tenantId: input.tenantId,
        id,
      });
      if (!created) throw new Error("workflow_insert_missing");
      return created;
    });
  }

  async getWorkflow(input: {
    tenantId: string;
    operatorUserId: string;
    repository?: string;
  }): Promise<CandyBarWorkflowRecord | null> {
    const repository = input.repository ?? CANDY_BAR_ALLOWED_REPOSITORY;
    return this.withSchemaGuard(async db => {
      const [row] = await db
        .select()
        .from(candyBarWorkflows)
        .where(
          and(
            eq(candyBarWorkflows.tenantId, input.tenantId),
            eq(candyBarWorkflows.operatorUserId, input.operatorUserId),
            eq(candyBarWorkflows.repository, repository)
          )
        )
        .limit(1);
      return row ? mapWorkflowRow(row) : null;
    });
  }

  async getWorkflowById(input: {
    tenantId: string;
    id: string;
    operatorUserId?: string;
  }): Promise<CandyBarWorkflowRecord | null> {
    return this.withSchemaGuard(async db => {
      const conditions = [
        eq(candyBarWorkflows.id, input.id),
        eq(candyBarWorkflows.tenantId, input.tenantId),
      ];
      if (input.operatorUserId) {
        conditions.push(eq(candyBarWorkflows.operatorUserId, input.operatorUserId));
      }
      const [row] = await db
        .select()
        .from(candyBarWorkflows)
        .where(and(...conditions))
        .limit(1);
      return row ? mapWorkflowRow(row) : null;
    });
  }

  async createRun(input: {
    tenantId: string;
    operatorUserId: string;
    workflowId: string;
    parentRunId?: string | null;
    baseSha?: string | null;
  }): Promise<CandyBarRunRecord> {
    return this.withSchemaGuard(async db => {
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
      const now = new Date();
      const id = randomUUID();
      await db.insert(candyBarRuns).values({
        id,
        tenantId: input.tenantId,
        operatorUserId: input.operatorUserId,
        workflowId: wf.id,
        workflowType: "engineering_slice",
        goalSnapshotJson: goalSnapshot,
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
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        completedAt: null,
      });
      const run = await this.getRun({ tenantId: input.tenantId, id });
      if (!run) throw new Error("run_insert_missing");
      return run;
    });
  }

  async getRun(input: {
    tenantId: string;
    id: string;
    operatorUserId?: string;
  }): Promise<CandyBarRunRecord | null> {
    return this.withSchemaGuard(async db => {
      const conditions = [eq(candyBarRuns.id, input.id), eq(candyBarRuns.tenantId, input.tenantId)];
      if (input.operatorUserId) {
        conditions.push(eq(candyBarRuns.operatorUserId, input.operatorUserId));
      }
      const [row] = await db
        .select()
        .from(candyBarRuns)
        .where(and(...conditions))
        .limit(1);
      return row ? mapRunRow(row) : null;
    });
  }

  async listRuns(input: {
    tenantId: string;
    operatorUserId: string;
    limit?: number;
  }): Promise<CandyBarRunRecord[]> {
    return this.withSchemaGuard(async db => {
      const rows = await db
        .select()
        .from(candyBarRuns)
        .where(
          and(
            eq(candyBarRuns.tenantId, input.tenantId),
            eq(candyBarRuns.operatorUserId, input.operatorUserId)
          )
        )
        .orderBy(desc(candyBarRuns.createdAt))
        .limit(input.limit ?? 50);
      return rows.map(mapRunRow);
    });
  }

  async transitionRun(input: {
    runId: string;
    from: CandyBarRunState;
    to: CandyBarRunState;
    patch?: Partial<CandyBarRunRecord>;
  }): Promise<CandyBarRunRecord | null> {
    return this.withSchemaGuard(async db => {
      const [row] = await db
        .select()
        .from(candyBarRuns)
        .where(eq(candyBarRuns.id, input.runId))
        .limit(1);
      if (!row || row.state !== input.from) return null;
      if (!canTransitionCandyBar(input.from, input.to)) {
        throw new Error(`invalid_transition:${input.from}->${input.to}`);
      }
      const run = mapRunRow(row);
      const now = new Date();
      const startedAt =
        run.startedAt ?? (input.to === "ASSEMBLING_CONTEXT" ? nowIso(now) : run.startedAt);
      let completedAt = run.completedAt;
      if (input.to === "COMPLETED" || input.to === "CANCELLED") {
        completedAt = nowIso(now);
      } else if (input.to === "READY_FOR_HUMAN") {
        completedAt = null;
      }
      const nextPatch: Partial<CandyBarRunRecord> = {
        ...input.patch,
        state: input.to,
        updatedAt: nowIso(now),
        startedAt,
        completedAt,
      };
      // Preserve sticky flags from memory semantics
      nextPatch.mergeAttempted =
        run.mergeAttempted || Boolean(input.patch?.mergeAttempted);
      nextPatch.deployAttempted =
        run.deployAttempted || Boolean(input.patch?.deployAttempted);
      nextPatch.productionMigrationAttempted =
        run.productionMigrationAttempted ||
        Boolean(input.patch?.productionMigrationAttempted);

      await db
        .update(candyBarRuns)
        .set(runRecordToDbPatch(nextPatch) as any)
        .where(and(eq(candyBarRuns.id, input.runId), eq(candyBarRuns.state, input.from)));

      const [updated] = await db
        .select()
        .from(candyBarRuns)
        .where(eq(candyBarRuns.id, input.runId))
        .limit(1);
      return updated ? mapRunRow(updated) : null;
    });
  }

  async updateRun(
    runId: string,
    patch: Partial<CandyBarRunRecord>
  ): Promise<CandyBarRunRecord | null> {
    return this.withSchemaGuard(async db => {
      const [row] = await db
        .select()
        .from(candyBarRuns)
        .where(eq(candyBarRuns.id, runId))
        .limit(1);
      if (!row) return null;
      const run = mapRunRow(row);
      const now = new Date();
      const nextPatch: Partial<CandyBarRunRecord> = {
        ...patch,
        mergeAttempted: run.mergeAttempted || Boolean(patch.mergeAttempted),
        deployAttempted: run.deployAttempted || Boolean(patch.deployAttempted),
        productionMigrationAttempted:
          run.productionMigrationAttempted || Boolean(patch.productionMigrationAttempted),
        updatedAt: nowIso(now),
      };
      await db
        .update(candyBarRuns)
        .set(runRecordToDbPatch(nextPatch) as any)
        .where(eq(candyBarRuns.id, runId));
      const [updated] = await db
        .select()
        .from(candyBarRuns)
        .where(eq(candyBarRuns.id, runId))
        .limit(1);
      return updated ? mapRunRow(updated) : null;
    });
  }

  async createStep(input: {
    runId: string;
    kind: CandyBarStepKind;
    idempotencyKey: string;
    status?: CandyBarStepStatus;
  }): Promise<CandyBarStepRecord> {
    return this.withSchemaGuard(async db => {
      const now = new Date();
      const id = randomUUID();
      try {
        await db.insert(candyBarSteps).values({
          id,
          runId: input.runId,
          kind: input.kind,
          status: input.status ?? "ready",
          attemptNumber: 0,
          provider: null,
          providerSessionId: null,
          inputArtifactIdsJson: [],
          outputArtifactIdsJson: [],
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
          createdAt: now,
          updatedAt: now,
        });
      } catch (error) {
        if (isMysqlDuplicateKeyError(error)) {
          const [existing] = await db
            .select()
            .from(candyBarSteps)
            .where(eq(candyBarSteps.idempotencyKey, input.idempotencyKey))
            .limit(1);
          if (existing) return mapStepRow(existing);
        }
        throw error;
      }
      // Bump run stepCount / currentStepId like memory store
      const [runRow] = await db
        .select()
        .from(candyBarRuns)
        .where(eq(candyBarRuns.id, input.runId))
        .limit(1);
      if (runRow) {
        await db
          .update(candyBarRuns)
          .set({
            stepCount: runRow.stepCount + 1,
            currentStepId: id,
            updatedAt: now,
          })
          .where(eq(candyBarRuns.id, input.runId));
      }
      const [created] = await db
        .select()
        .from(candyBarSteps)
        .where(eq(candyBarSteps.id, id))
        .limit(1);
      if (!created) throw new Error("step_insert_missing");
      return mapStepRow(created);
    });
  }

  async getStep(id: string): Promise<CandyBarStepRecord | null> {
    return this.withSchemaGuard(async db => {
      const [row] = await db
        .select()
        .from(candyBarSteps)
        .where(eq(candyBarSteps.id, id))
        .limit(1);
      return row ? mapStepRow(row) : null;
    });
  }

  async listSteps(runId: string): Promise<CandyBarStepRecord[]> {
    return this.withSchemaGuard(async db => {
      const rows = await db
        .select()
        .from(candyBarSteps)
        .where(eq(candyBarSteps.runId, runId))
        .orderBy(asc(candyBarSteps.createdAt));
      return rows.map(mapStepRow);
    });
  }

  async updateStep(
    id: string,
    patch: Partial<CandyBarStepRecord>
  ): Promise<CandyBarStepRecord | null> {
    return this.withSchemaGuard(async db => {
      const [row] = await db
        .select()
        .from(candyBarSteps)
        .where(eq(candyBarSteps.id, id))
        .limit(1);
      if (!row) return null;
      const now = new Date();
      await db
        .update(candyBarSteps)
        .set({ ...stepRecordToDbPatch(patch), updatedAt: now } as any)
        .where(eq(candyBarSteps.id, id));
      const [updated] = await db
        .select()
        .from(candyBarSteps)
        .where(eq(candyBarSteps.id, id))
        .limit(1);
      return updated ? mapStepRow(updated) : null;
    });
  }

  async claimStep(input: {
    stepId: string;
    leaseOwner: string;
    leaseMs: number;
    now?: Date;
  }): Promise<CandyBarStepRecord | null> {
    return this.withSchemaGuard(async db => {
      const [row] = await db
        .select()
        .from(candyBarSteps)
        .where(eq(candyBarSteps.id, input.stepId))
        .limit(1);
      if (!row) return null;
      const step = mapStepRow(row);
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
      const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);
      await db
        .update(candyBarSteps)
        .set({
          status: "leased",
          leaseOwner: input.leaseOwner,
          leaseExpiresAt,
          attemptNumber: step.attemptNumber + 1,
          updatedAt: now,
        })
        .where(eq(candyBarSteps.id, input.stepId));
      const [updated] = await db
        .select()
        .from(candyBarSteps)
        .where(eq(candyBarSteps.id, input.stepId))
        .limit(1);
      return updated ? mapStepRow(updated) : null;
    });
  }

  async claimRunnableRun(input: {
    leaseOwner: string;
    leaseMs: number;
    now?: Date;
    states?: CandyBarRunState[];
  }): Promise<CandyBarRunRecord | null> {
    return this.withSchemaGuard(async db => {
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
      const rows = await db
        .select()
        .from(candyBarRuns)
        .where(inArray(candyBarRuns.state, active))
        .orderBy(asc(candyBarRuns.updatedAt))
        .limit(100);
      const candidates = rows
        .map(mapRunRow)
        .filter(r => {
          if (r.state === "CANCELLED" || r.state === "COMPLETED") return false;
          if (r.nextRetryAt && new Date(r.nextRetryAt).getTime() > now.getTime()) return false;
          const leaseExpired =
            !r.leaseExpiresAt || new Date(r.leaseExpiresAt).getTime() <= now.getTime();
          if (r.leaseOwner && !leaseExpired && r.leaseOwner !== input.leaseOwner) return false;
          return true;
        });
      const run = candidates[0];
      if (!run) return null;
      const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);
      await db
        .update(candyBarRuns)
        .set({
          leaseOwner: input.leaseOwner,
          leaseExpiresAt,
          updatedAt: now,
        })
        .where(eq(candyBarRuns.id, run.id));
      const [updated] = await db
        .select()
        .from(candyBarRuns)
        .where(eq(candyBarRuns.id, run.id))
        .limit(1);
      return updated ? mapRunRow(updated) : null;
    });
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
    return this.withSchemaGuard(async db => {
      const now = new Date();
      const id = randomUUID();
      await db.insert(candyBarArtifacts).values({
        id,
        runId: input.runId,
        type: input.type,
        schemaVersion: input.schemaVersion ?? 1,
        producer: input.producer,
        provider: input.provider,
        contentJson: structuredClone(input.content),
        metadataJson: structuredClone(input.metadata ?? {}),
        createdAt: now,
      });
      const [row] = await db
        .select()
        .from(candyBarArtifacts)
        .where(eq(candyBarArtifacts.id, id))
        .limit(1);
      if (!row) throw new Error("artifact_insert_missing");
      return mapArtifactRow(row);
    });
  }

  async listArtifacts(runId: string): Promise<CandyBarArtifactRecord[]> {
    return this.withSchemaGuard(async db => {
      const rows = await db
        .select()
        .from(candyBarArtifacts)
        .where(eq(candyBarArtifacts.runId, runId))
        .orderBy(asc(candyBarArtifacts.createdAt));
      return rows.map(mapArtifactRow);
    });
  }

  async latestArtifact(
    runId: string,
    type: CandyBarArtifactType
  ): Promise<CandyBarArtifactRecord | null> {
    return this.withSchemaGuard(async db => {
      const rows = await db
        .select()
        .from(candyBarArtifacts)
        .where(and(eq(candyBarArtifacts.runId, runId), eq(candyBarArtifacts.type, type)))
        .orderBy(desc(candyBarArtifacts.createdAt))
        .limit(1);
      return rows[0] ? mapArtifactRow(rows[0]) : null;
    });
  }

  async createApproval(
    input: Omit<CandyBarApprovalRecord, "id" | "createdAt">
  ): Promise<CandyBarApprovalRecord> {
    return this.withSchemaGuard(async db => {
      const now = new Date();
      const id = randomUUID();
      await db.insert(candyBarApprovals).values({
        id,
        runId: input.runId,
        tenantId: input.tenantId,
        operatorUserId: input.operatorUserId,
        action: input.action,
        reason: input.reason,
        actorUserId: input.actorUserId,
        createdAt: now,
      });
      const [row] = await db
        .select()
        .from(candyBarApprovals)
        .where(eq(candyBarApprovals.id, id))
        .limit(1);
      if (!row) throw new Error("approval_insert_missing");
      return mapApprovalRow(row);
    });
  }

  async listApprovals(runId: string): Promise<CandyBarApprovalRecord[]> {
    return this.withSchemaGuard(async db => {
      const rows = await db
        .select()
        .from(candyBarApprovals)
        .where(eq(candyBarApprovals.runId, runId))
        .orderBy(asc(candyBarApprovals.createdAt));
      return rows.map(mapApprovalRow);
    });
  }
}

