import { and, asc, desc, eq } from "drizzle-orm";
import {
  goalCycleDecisions,
  goalCycleObjectives,
  goalCycleOutcomes,
  goalCycleLearnedDeltas,
  macroGoalRuns,
} from "../../../drizzle/schema";
import { getDb } from "../../db";
import { optionalReceiptRows } from "./operationReceipt";
import {
  getGoalCycleLearnedDelta,
  listGoalCycleLearnedDeltas,
  processPendingOutcomeLearnings,
  type GoalCycleLearnedDeltaRecord,
} from "./learningStore";
import { operationReceipt } from "./operationReceipt";

export type ScoreboardPrecision = "exact" | "recorded_only" | "unknown";
export type ScoreboardCoverage = "complete" | "conflicting" | "unavailable";
export type EconomicPrecision = "exact" | "recorded_only" | "conflicting" | "none";

export type PersistentGrowthScoreboard = {
  tenantId: string;
  canonicalOperatorId: string;
  goalRunId: string | null;
  metricKey: string | null;
  targetValue: number | null;
  unit: string | null;
  authoritativeObservedValue: number | null;
  remainingGap: number | null;
  precision: ScoreboardPrecision;
  coverage: ScoreboardCoverage;
  selectedWorkCount: number;
  executedWorkCount: number;
  awaitingEvidenceCount: number;
  successfulOutcomesCount: number;
  failedOutcomesCount: number;
  unresolvedOutcomesCount: number;
  attributableEconomicValueCents: number | null;
  economicPrecision: EconomicPrecision;
  learnedDeltasCount: number;
  activeLearnedDeltas: Array<{
    id: string;
    learningKind: string;
    targetKey: string;
    deltaType: string;
    explanation: string;
  }>;
};

export type LoadoutDeltaExplainable = {
  deltaId: string;
  tenantId: string;
  targetKey: string;
  learningKind: string;
  deltaType: string;
  before: Record<string, unknown> | null;
  observedEvidenceOutcome: {
    outcomeId: string;
    evidenceReference: string;
    confidence: string;
  };
  evaluation: string;
  change: {
    deltaType: string;
    targetKey: string;
  };
  after: Record<string, unknown>;
  createdAt: string;
};

export type ExplainableHistoryItem = {
  decisionId: string;
  goalRunId: string;
  cycleId: string;
  businessDate: string;
  selection: {
    kind: string;
    selectedRef: string | null;
    executionType: string | null;
    reasonCode: string;
  };
  loadoutCount: number;
  authority: {
    status: string;
    basis?: string | null;
  };
  objective: {
    id: string | null;
    title: string | null;
    status: string | null;
  } | null;
  verification: {
    status: string;
    evidenceReference?: string | null;
  };
  outcome: {
    status: string;
    kind?: string | null;
    monetaryValueCents?: number | null;
  };
  learningDelta: {
    status: string;
    deltaType?: string | null;
    explanation?: string | null;
  };
  createdAt: string;
};

/**
 * Builds the Authoritative Scoreboard for a tenant and operator.
 * Rebuilt purely from authoritative persisted records.
 * Never grants authority, creates evidence, or manufactures precision.
 */
export async function getAuthoritativeScoreboard(input: {
  tenantId: string;
  canonicalOperatorId?: string;
  goalRunId?: string;
}): Promise<PersistentGrowthScoreboard> {
  if (!input.tenantId.trim()) throw new Error("tenantId is required");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  // 1. Load active or specified macro goal run
  const runConditions = [eq(macroGoalRuns.tenantId, input.tenantId)];
  if (input.goalRunId) {
    runConditions.push(eq(macroGoalRuns.id, input.goalRunId));
  } else if (input.canonicalOperatorId) {
    runConditions.push(eq(macroGoalRuns.canonicalOperatorId, input.canonicalOperatorId));
  }

  const [activeRun] = await db
    .select()
    .from(macroGoalRuns)
    .where(and(...runConditions))
    .orderBy(desc(macroGoalRuns.createdAt))
    .limit(1);

  const canonicalOperatorId =
    input.canonicalOperatorId ??
    activeRun?.canonicalOperatorId ??
    "unspecified";

  // 2. Reconcile any pending outcome learnings to guarantee eventual consistency
  await processPendingOutcomeLearnings({ tenantId: input.tenantId }).catch(err => {
    console.warn("[proofReadModels] processPendingOutcomeLearnings deferred", err);
  });

  // 3. Query decisions, objectives, outcomes, and learned deltas
  const [decisions, objectives, outcomes, learnedDeltas] = await Promise.all([
    optionalReceiptRows(() =>
      db
        .select()
        .from(goalCycleDecisions)
        .where(
          and(
            eq(goalCycleDecisions.tenantId, input.tenantId),
            activeRun ? eq(goalCycleDecisions.goalRunId, activeRun.id) : undefined
          )
        )
    ),
    optionalReceiptRows(() =>
      db
        .select()
        .from(goalCycleObjectives)
        .where(
          and(
            eq(goalCycleObjectives.tenantId, input.tenantId),
            activeRun ? eq(goalCycleObjectives.goalRunId, activeRun.id) : undefined
          )
        )
    ),
    optionalReceiptRows(() =>
      db
        .select()
        .from(goalCycleOutcomes)
        .where(
          and(
            eq(goalCycleOutcomes.tenantId, input.tenantId),
            activeRun ? eq(goalCycleOutcomes.goalRunId, activeRun.id) : undefined
          )
        )
    ),
    optionalReceiptRows(() =>
      db
        .select()
        .from(goalCycleLearnedDeltas)
        .where(
          and(
            eq(goalCycleLearnedDeltas.tenantId, input.tenantId),
            activeRun ? eq(goalCycleLearnedDeltas.goalRunId, activeRun.id) : undefined
          )
        )
    ),
  ]);

  // 3. Compute metrics
  const selectedWorkCount = decisions.filter(d => d.selectionKind !== "wait").length;

  const executedWorkCount = objectives.filter(
    o => o.status === "action_executed" || o.status === "completed"
  ).length;

  const awaitingEvidenceCount = objectives.filter(
    o =>
      o.status === "presented" ||
      o.status === "accepted" ||
      o.status === "in_progress" ||
      o.status === "action_attempted"
  ).length;

  const successfulOutcomesCount = outcomes.filter(
    o => o.epistemicStatus === "verified" && !o.outcomeKind.includes("failed") && !o.outcomeKind.includes("blocked")
  ).length;

  const failedOutcomesCount = outcomes.filter(
    o => o.epistemicStatus === "rejected" || o.outcomeKind.includes("failed") || o.outcomeKind.includes("blocked")
  ).length;

  const unresolvedOutcomesCount = outcomes.filter(
    o => o.epistemicStatus === "unverified" || o.epistemicStatus === "disputed"
  ).length;

  // Economic truth: sum verified monetary cents; detect conflicting attribution
  const economicOutcomes = outcomes.filter(
    o => o.impactClass === "commercial_revenue" || o.monetaryValueCents !== null
  );

  let attributableEconomicValueCents: number | null = null;
  let economicPrecision: EconomicPrecision = "none";

  if (economicOutcomes.length > 0) {
    const hasConflicting = economicOutcomes.some(
      o => o.epistemicStatus === "disputed" || o.epistemicStatus === "unverified"
    );
    if (hasConflicting) {
      economicPrecision = "conflicting";
      attributableEconomicValueCents = null; // Fails closed: conflict means unresolved total
    } else {
      const isExternalLedgerVerified = economicOutcomes.every(
        o => o.sourceSystem === "cleancloud" || o.sourceSystem === "stripe" || o.sourceSystem === "shopify"
      );
      economicPrecision = isExternalLedgerVerified ? "exact" : "recorded_only";
      attributableEconomicValueCents = economicOutcomes.reduce(
        (sum, o) => sum + (o.monetaryValueCents ?? 0),
        0
      );
    }
  }

  // Authoritative observed value from macro goal
  const targetValue = activeRun?.targetValue != null ? Number(activeRun.targetValue) : null;
  let authoritativeObservedValue: number | null = null;
  let remainingGap: number | null = null;
  let precision: ScoreboardPrecision = "unknown";
  let coverage: ScoreboardCoverage = "unavailable";

  const baselineNum = activeRun?.baselineValue != null ? Number(activeRun.baselineValue) : null;
  const runStartedMs = activeRun?.startedAt
    ? new Date(activeRun.startedAt).getTime()
    : activeRun?.createdAt
      ? new Date(activeRun.createdAt).getTime()
      : 0;

  // Prevent double-counting: only add outcomes observed at or after run baseline start
  const incrementalEconomicOutcomes = economicOutcomes.filter(o => {
    if (!runStartedMs || !activeRun?.baselineObservationRef) return true;
    const outcomeObservedMs = o.observedAt ? new Date(o.observedAt).getTime() : 0;
    return outcomeObservedMs >= runStartedMs;
  });

  const incrementalRevenueDollars =
    incrementalEconomicOutcomes.reduce((sum, o) => sum + (o.monetaryValueCents ?? 0), 0) / 100;
  const newRevenueDollars =
    attributableEconomicValueCents != null ? attributableEconomicValueCents / 100 : 0;

  if (activeRun?.baselineObservationRef) {
    authoritativeObservedValue = baselineNum != null ? baselineNum + incrementalRevenueDollars : null;
    precision =
      activeRun.baselinePrecision === "exact" && economicPrecision === "exact"
        ? "exact"
        : activeRun.baselinePrecision === "recorded_only" || economicPrecision === "recorded_only"
          ? "recorded_only"
          : "unknown";
    coverage =
      activeRun.baselineCoverage === "complete"
        ? "complete"
        : activeRun.baselineCoverage === "conflicting"
          ? "conflicting"
          : "unavailable";

    if (
      targetValue != null &&
      authoritativeObservedValue != null &&
      coverage === "complete"
    ) {
      remainingGap = Math.max(0, targetValue - authoritativeObservedValue);
    }
  } else if (attributableEconomicValueCents != null) {
    authoritativeObservedValue = newRevenueDollars;
    precision = economicPrecision === "exact" ? "exact" : "recorded_only";
    coverage = "complete";
    if (targetValue != null) {
      remainingGap = Math.max(0, targetValue - authoritativeObservedValue);
    }
  }

  const activeLearnedDeltas = learnedDeltas.slice(0, 10).map(d => ({
    id: d.id,
    learningKind: d.learningKind,
    targetKey: d.targetKey,
    deltaType: d.deltaType,
    explanation: d.explanation,
  }));

  return {
    tenantId: input.tenantId,
    canonicalOperatorId,
    goalRunId: activeRun?.id ?? null,
    metricKey: activeRun?.metricKey ?? null,
    targetValue,
    unit: activeRun?.unit ?? null,
    authoritativeObservedValue,
    remainingGap,
    precision,
    coverage,
    selectedWorkCount,
    executedWorkCount,
    awaitingEvidenceCount,
    successfulOutcomesCount,
    failedOutcomesCount,
    unresolvedOutcomesCount,
    attributableEconomicValueCents,
    economicPrecision,
    learnedDeltasCount: learnedDeltas.length,
    activeLearnedDeltas,
  };
}

/**
 * Returns an explainable LoadoutDelta for inspection.
 */
export async function getLoadoutDelta(input: {
  tenantId: string;
  deltaId?: string;
  canonicalOperatorId?: string;
}): Promise<LoadoutDeltaExplainable | null> {
  await processPendingOutcomeLearnings({ tenantId: input.tenantId }).catch(err => {
    console.warn("[proofReadModels] processPendingOutcomeLearnings deferred", err);
  });

  let delta: GoalCycleLearnedDeltaRecord | null = null;
  if (input.deltaId) {
    delta = await getGoalCycleLearnedDelta({
      tenantId: input.tenantId,
      deltaId: input.deltaId,
    });
  } else {
    const deltas = await listGoalCycleLearnedDeltas({
      tenantId: input.tenantId,
      canonicalOperatorId: input.canonicalOperatorId,
      limit: 1,
    });
    delta = deltas[0] ?? null;
  }
  if (!delta) return null;

  return {
    deltaId: delta.id,
    tenantId: delta.tenantId,
    targetKey: delta.targetKey,
    learningKind: delta.learningKind,
    deltaType: delta.deltaType,
    before: delta.beforeState,
    observedEvidenceOutcome: {
      outcomeId: delta.outcomeId,
      evidenceReference: delta.evidenceReference,
      confidence: delta.confidence,
    },
    evaluation: delta.explanation,
    change: {
      deltaType: delta.deltaType,
      targetKey: delta.targetKey,
    },
    after: delta.afterState,
    createdAt: delta.createdAt,
  };
}

/**
 * Returns a coherent, tenant-scoped explainable history of operations.
 */
export async function getPersistentGrowthHistory(input: {
  tenantId: string;
  canonicalOperatorId?: string;
  limit?: number;
}): Promise<ExplainableHistoryItem[]> {
  if (!input.tenantId.trim()) throw new Error("tenantId is required");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const where = [eq(goalCycleDecisions.tenantId, input.tenantId)];
  if (input.canonicalOperatorId) {
    where.push(eq(goalCycleDecisions.canonicalOperatorId, input.canonicalOperatorId));
  }

  const decisions = await db
    .select()
    .from(goalCycleDecisions)
    .where(and(...where))
    .orderBy(desc(goalCycleDecisions.createdAt))
    .limit(input.limit ?? 25);

  const historyItems: ExplainableHistoryItem[] = [];

  for (const decision of decisions) {
    const receipt = await operationReceipt({
      tenantId: input.tenantId,
      decisionId: decision.id,
    });
    if (!receipt) continue;

    const objectiveValue =
      receipt.humanObjective.status === "resolved"
        ? receipt.humanObjective.value
        : null;

    const verificationStatus = receipt.verification.status;
    const verificationRef =
      receipt.verification.status === "resolved"
        ? receipt.verification.value.evidenceReference
        : null;

    const outcomeStatus = receipt.businessOutcome.status;
    const outcomeKind =
      receipt.businessOutcome.status === "resolved"
        ? receipt.businessOutcome.value.outcomeKind
        : null;

    const monetaryCents =
      receipt.economicObservation.status === "resolved"
        ? receipt.economicObservation.value.monetaryValueCents
        : null;

    // Check learning delta for this decision
    const learningDeltas = await listGoalCycleLearnedDeltas({
      tenantId: input.tenantId,
      decisionId: decision.id,
      limit: 1,
    });
    const firstDelta = learningDeltas[0] ?? null;

    historyItems.push({
      decisionId: decision.id,
      goalRunId: decision.goalRunId,
      cycleId: decision.cycleId,
      businessDate: decision.weekStart ?? decision.createdAt.toISOString().slice(0, 10),
      selection: {
        kind: decision.selectionKind,
        selectedRef: decision.selectedRef,
        executionType: decision.selectedExecutionType,
        reasonCode: decision.selectedReasonCode,
      },
      loadoutCount: decision.loadoutJson ? (decision.loadoutJson as unknown[]).length : 0,
      authority: {
        status: receipt.authority.status,
        basis: receipt.authority.status === "resolved" ? receipt.authority.value.authorityBasis : null,
      },
      objective: objectiveValue
        ? {
            id: objectiveValue.objectiveId,
            title: objectiveValue.title,
            status: objectiveValue.status,
          }
        : null,
      verification: {
        status: verificationStatus,
        evidenceReference: verificationRef,
      },
      outcome: {
        status: outcomeStatus,
        kind: outcomeKind,
        monetaryValueCents: monetaryCents,
      },
      learningDelta: firstDelta
        ? {
            status: "resolved",
            deltaType: firstDelta.deltaType,
            explanation: firstDelta.explanation,
          }
        : {
            status: "unresolved",
          },
      createdAt: decision.createdAt.toISOString(),
    });
  }

  return historyItems;
}
