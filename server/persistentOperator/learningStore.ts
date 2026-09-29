import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  goalCycleLearnedDeltas,
  macroGoalRuns,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { isMysqlDuplicateKeyError } from "../mysqlErrors";
import {
  assertBusinessTruthEvidence,
  canSupportBusinessTruth,
  type GoldlineEvidenceClass,
} from "../../shared/goldlineTruthContract";
import {
  getGoalCycleOutcome,
  type GoalCycleOutcomeRecord,
} from "./outcomeStore";
import { getGoalCycleDecision } from "./decisionStore";
import { getGoalCycleObjective } from "./objectiveStore";

export const LEARNING_KINDS = [
  "doctrine_weight",
  "loadout_recommendation",
  "channel_affinity",
  "time_preference",
  "candidate_boost",
  "execution_constraint",
] as const;

export type LearningKind = (typeof LEARNING_KINDS)[number];

export const DELTA_TYPES = [
  "boost",
  "suppress",
  "reinforce",
  "constraint",
] as const;

export type DeltaType = (typeof DELTA_TYPES)[number];

export type GoalCycleLearnedDeltaRecord = {
  id: string;
  tenantId: string;
  goalRunId: string;
  cycleId: string;
  decisionId: string;
  objectiveId: string;
  outcomeId: string;
  canonicalOperatorId: string;
  operatorUserId: string;
  learningKind: LearningKind;
  targetKey: string;
  deltaType: DeltaType;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown>;
  evidenceReference: string;
  confidence: "high" | "medium" | "low";
  explanation: string;
  appliedCount: number;
  createdAt: string;
  updatedAt: string;
};

export type EvaluateOutcomeLearningInput = {
  tenantId: string;
  outcomeId: string;
  targetKey?: string;
  learningKind?: LearningKind;
  deltaType?: DeltaType;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  explanation?: string | null;
  isStale?: boolean;
  isConflicting?: boolean;
};

function toRecord(
  row: typeof goalCycleLearnedDeltas.$inferSelect
): GoalCycleLearnedDeltaRecord {
  const learningKind: LearningKind = (
    LEARNING_KINDS as readonly string[]
  ).includes(row.learningKind)
    ? (row.learningKind as LearningKind)
    : "doctrine_weight";

  const deltaType: DeltaType = (
    DELTA_TYPES as readonly string[]
  ).includes(row.deltaType)
    ? (row.deltaType as DeltaType)
    : "boost";

  const beforeState =
    row.beforeStateJson && typeof row.beforeStateJson === "object"
      ? (row.beforeStateJson as Record<string, unknown>)
      : null;

  const afterState =
    row.afterStateJson && typeof row.afterStateJson === "object"
      ? (row.afterStateJson as Record<string, unknown>)
      : {};

  const confidence: "high" | "medium" | "low" =
    row.confidence === "low" || row.confidence === "medium"
      ? row.confidence
      : "high";

  return {
    id: row.id,
    tenantId: row.tenantId,
    goalRunId: row.goalRunId,
    cycleId: row.cycleId,
    decisionId: row.decisionId,
    objectiveId: row.objectiveId,
    outcomeId: row.outcomeId,
    canonicalOperatorId: row.canonicalOperatorId,
    operatorUserId: row.operatorUserId,
    learningKind,
    targetKey: row.targetKey,
    deltaType,
    beforeState,
    afterState,
    evidenceReference: row.evidenceReference,
    confidence,
    explanation: row.explanation,
    appliedCount: row.appliedCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getGoalCycleLearnedDelta(input: {
  tenantId: string;
  deltaId: string;
}): Promise<GoalCycleLearnedDeltaRecord | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db
    .select()
    .from(goalCycleLearnedDeltas)
    .where(
      and(
        eq(goalCycleLearnedDeltas.tenantId, input.tenantId),
        eq(goalCycleLearnedDeltas.id, input.deltaId)
      )
    )
    .limit(1);
  return row ? toRecord(row) : null;
}

export async function findLearnedDeltaByIdempotencyKey(input: {
  tenantId: string;
  outcomeId: string;
  learningKind: string;
  targetKey: string;
}): Promise<GoalCycleLearnedDeltaRecord | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db
    .select()
    .from(goalCycleLearnedDeltas)
    .where(
      and(
        eq(goalCycleLearnedDeltas.tenantId, input.tenantId),
        eq(goalCycleLearnedDeltas.outcomeId, input.outcomeId),
        eq(goalCycleLearnedDeltas.learningKind, input.learningKind),
        eq(goalCycleLearnedDeltas.targetKey, input.targetKey)
      )
    )
    .limit(1);
  return row ? toRecord(row) : null;
}

export async function listGoalCycleLearnedDeltas(input: {
  tenantId: string;
  canonicalOperatorId?: string;
  decisionId?: string;
  objectiveId?: string;
  goalRunId?: string;
  learningKind?: LearningKind;
  targetKey?: string;
  limit?: number;
}): Promise<GoalCycleLearnedDeltaRecord[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const where = [eq(goalCycleLearnedDeltas.tenantId, input.tenantId)];

  if (input.canonicalOperatorId) {
    where.push(
      eq(goalCycleLearnedDeltas.canonicalOperatorId, input.canonicalOperatorId)
    );
  }
  if (input.decisionId) {
    where.push(eq(goalCycleLearnedDeltas.decisionId, input.decisionId));
  }
  if (input.objectiveId) {
    where.push(eq(goalCycleLearnedDeltas.objectiveId, input.objectiveId));
  }
  if (input.goalRunId) {
    where.push(eq(goalCycleLearnedDeltas.goalRunId, input.goalRunId));
  }
  if (input.learningKind) {
    where.push(eq(goalCycleLearnedDeltas.learningKind, input.learningKind));
  }
  if (input.targetKey) {
    where.push(eq(goalCycleLearnedDeltas.targetKey, input.targetKey));
  }

  const rows = await db
    .select()
    .from(goalCycleLearnedDeltas)
    .where(and(...where))
    .orderBy(desc(goalCycleLearnedDeltas.createdAt))
    .limit(input.limit ?? 50);

  return rows.map(toRecord);
}

export async function getLearnedDeltasByDecision(input: {
  tenantId: string;
  decisionId: string;
}): Promise<GoalCycleLearnedDeltaRecord[]> {
  return listGoalCycleLearnedDeltas(input);
}

/**
 * Resolves the primary technique or teaching key associated with an outcome
 * by inspecting the originating objective or decision loadout.
 */
export async function resolveTargetKeyFromOutcome(outcome: GoalCycleOutcomeRecord): Promise<string> {
  // 1. Try objective loadout
  if (outcome.objectiveId) {
    try {
      const objective = await getGoalCycleObjective({
        tenantId: outcome.tenantId,
        objectiveId: outcome.objectiveId,
      });
      if (objective?.loadout?.length && objective.loadout[0]?.key) {
        return objective.loadout[0].key;
      }
    } catch {
      // Objective store lookup optional/fallback
    }
  }

  // 2. Try decision loadout
  if (outcome.decisionId) {
    try {
      const decision = await getGoalCycleDecision({
        tenantId: outcome.tenantId,
        decisionId: outcome.decisionId,
      });
      if (decision?.loadout?.length && decision.loadout[0]?.key) {
        return decision.loadout[0].key;
      }
    } catch {
      // Decision store lookup optional/fallback
    }
  }

  // 3. Fallback to outcomeKind
  return outcome.outcomeKind;
}

/**
 * Derives the deterministic learned delta from an authoritative outcome record and previous state.
 * Crucially: learning = f(authoritative receipts, authoritative outcomes, prior state), NOT model opinion.
 */
function deriveDeterministicLearning(
  outcome: GoalCycleOutcomeRecord,
  targetKey: string,
  priorDelta: GoalCycleLearnedDeltaRecord | null
): {
  learningKind: LearningKind;
  targetKey: string;
  deltaType: DeltaType;
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
  explanation: string;
  confidence: "high" | "medium" | "low";
} {
  const priorState = (priorDelta?.afterState ?? {}) as Record<string, unknown>;
  const priorWeight = typeof priorState.doctrineWeight === "number" ? priorState.doctrineWeight : 1.0;
  const priorSampleSize = typeof priorState.sampleSize === "number" ? priorState.sampleSize : 0;
  const priorDeliveries = typeof priorState.verifiedDeliveries === "number" ? priorState.verifiedDeliveries : 0;
  const priorRevenueCents = typeof priorState.verifiedRevenueCents === "number" ? priorState.verifiedRevenueCents : 0;
  const priorFailures = typeof priorState.failureCount === "number" ? priorState.failureCount : 0;

  const beforeState: Record<string, unknown> = priorDelta
    ? priorState
    : {
        doctrineWeight: 1.0,
        sampleSize: 0,
        verifiedDeliveries: 0,
        verifiedRevenueCents: 0,
      };

  if (outcome.impactClass === "commercial_revenue" && outcome.monetaryValueCents != null) {
    const newSampleSize = priorSampleSize + 1;
    const newRevenueCents = priorRevenueCents + outcome.monetaryValueCents;
    const weightBump = outcome.monetaryValueCents >= 10000 ? 0.20 : 0.10;
    const newWeight = Math.min(2.5, Number((priorWeight + weightBump).toFixed(2)));
    const confidence: "high" | "medium" | "low" =
      newSampleSize >= 5 ? "high" : newSampleSize >= 2 ? "medium" : "low";
    const revenueDollars = (outcome.monetaryValueCents / 100).toFixed(2);
    const cumulativeDollars = (newRevenueCents / 100).toFixed(2);

    return {
      learningKind: "doctrine_weight",
      targetKey,
      deltaType: "boost",
      beforeState,
      afterState: {
        doctrineWeight: newWeight,
        sampleSize: newSampleSize,
        verifiedDeliveries: priorDeliveries,
        verifiedRevenueCents: newRevenueCents,
        lastVerifiedRevenueCents: outcome.monetaryValueCents,
        sourceSystem: outcome.sourceSystem,
      },
      explanation: `Verified commercial revenue of $${revenueDollars} (cumulative: $${cumulativeDollars}, n=${newSampleSize}) via ${outcome.sourceSystem}; boosted doctrine '${targetKey}' weight ${priorWeight.toFixed(2)} -> ${newWeight.toFixed(2)}.`,
      confidence,
    };
  }

  if (outcome.impactClass === "action_verification") {
    const newDeliveries = priorDeliveries + 1;
    const newSampleSize = priorSampleSize + 1;
    const newWeight = Math.min(2.0, Number((priorWeight + 0.05).toFixed(2)));
    const confidence: "high" | "medium" | "low" = newDeliveries >= 5 ? "high" : "medium";

    return {
      learningKind: "channel_affinity",
      targetKey,
      deltaType: "reinforce",
      beforeState,
      afterState: {
        doctrineWeight: newWeight,
        sampleSize: newSampleSize,
        verifiedDeliveries: newDeliveries,
        verifiedRevenueCents: priorRevenueCents,
        sourceSystem: outcome.sourceSystem,
        evidenceRef: outcome.evidenceReference,
      },
      explanation: `Action execution verified via ${outcome.sourceSystem} (deliveries: ${newDeliveries}, n=${newSampleSize}); reinforced channel affinity for '${targetKey}' weight ${priorWeight.toFixed(2)} -> ${newWeight.toFixed(2)}.`,
      confidence,
    };
  }

  if (outcome.epistemicStatus === "rejected" || outcome.outcomeKind.includes("failed") || outcome.outcomeKind.includes("blocked")) {
    const newFailures = priorFailures + 1;
    const newWeight = Math.max(0.2, Number((priorWeight - 0.25).toFixed(2)));
    const constrained = newFailures >= 2;

    return {
      learningKind: "execution_constraint",
      targetKey,
      deltaType: "suppress",
      beforeState,
      afterState: {
        doctrineWeight: newWeight,
        constrained,
        failureCount: newFailures,
        reason: outcome.explanation ?? "Action execution blocked or failed",
      },
      explanation: `Execution failure recorded for '${targetKey}' (failures: ${newFailures}); constrained doctrine weight ${priorWeight.toFixed(2)} -> ${newWeight.toFixed(2)}${constrained ? " [constrained: active]" : ""}.`,
      confidence: "high",
    };
  }

  const newSampleSize = priorSampleSize + 1;
  return {
    learningKind: "loadout_recommendation",
    targetKey,
    deltaType: "boost",
    beforeState,
    afterState: {
      priority: "elevated",
      sampleSize: newSampleSize,
      sourceSystem: outcome.sourceSystem,
    },
    explanation: `Operational outcome '${outcome.outcomeKind}' verified for '${targetKey}' (n=${newSampleSize}); elevating loadout priority.`,
    confidence: "medium",
  };
}

/**
 * Evaluates an authoritative outcome and records a deterministic learned delta.
 *
 * Enforces:
 * 1. Receipt-backed: relies on authoritative outcome and evidence references.
 * 2. Invariant: only verified outcomes can produce positive business learning.
 * 3. Freshness / Non-conflict: rejects stale or conflicting evidence.
 * 4. Delayed outcomes: attaches to originating historical goalRun and decision;
 *    does NOT reopen superseded or completed goals.
 * 5. Exactly-once counting: idempotency unique key ensures retries/worker restarts
 *    never count an outcome twice.
 * 6. Stateful & cumulative: reads prior active delta and increments sample size,
 *    accumulated revenue, and verified deliveries instead of hardcoding stubs.
 * 7. Real technique targeting: automatically resolves targetKey from originating
 *    objective/decision loadout so future selection consumes it directly.
 */
export async function evaluateOutcomeAndRecordLearning(
  input: EvaluateOutcomeLearningInput
): Promise<{ delta: GoalCycleLearnedDeltaRecord; created: boolean }> {
  if (!input.tenantId.trim()) throw new Error("tenantId is required");
  if (!input.outcomeId.trim()) throw new Error("outcomeId is required");

  if (input.isStale) {
    throw new Error("Stale evidence cannot produce current learning deltas");
  }
  if (input.isConflicting) {
    throw new Error("Conflicting evidence blocks learning until resolved");
  }

  const outcome = await getGoalCycleOutcome({
    tenantId: input.tenantId,
    outcomeId: input.outcomeId,
  });
  if (!outcome) {
    throw new Error(`Outcome '${input.outcomeId}' not found for tenant '${input.tenantId}'`);
  }

  // Only verified outcomes can produce authoritative learning
  if (outcome.epistemicStatus !== "verified") {
    throw new Error(
      `Cannot derive learning from outcome with unverified epistemic status: '${outcome.epistemicStatus}'`
    );
  }

  // Verify that evidence supports business truth
  assertBusinessTruthEvidence(
    [
      {
        sourceType: outcome.sourceSystem,
        sourceReference: outcome.evidenceReference,
        classification: outcome.evidenceClass,
        observedAt: outcome.observedAt,
      },
    ],
    `Learning delta for outcome '${outcome.outcomeKind}'`
  );

  const resolvedTargetKey = input.targetKey ?? (await resolveTargetKeyFromOutcome(outcome));
  const resolvedLearningKind =
    input.learningKind ??
    (outcome.impactClass === "commercial_revenue"
      ? "doctrine_weight"
      : outcome.impactClass === "action_verification"
        ? "channel_affinity"
        : "loadout_recommendation");

  // Query prior active delta for stateful, cumulative learning
  const existingDeltas = await listGoalCycleLearnedDeltas({
    tenantId: input.tenantId,
    targetKey: resolvedTargetKey,
    learningKind: resolvedLearningKind,
    limit: 1,
  });
  const priorDelta = existingDeltas[0] ?? null;

  const derived = deriveDeterministicLearning(outcome, resolvedTargetKey, priorDelta);
  const learningKind = input.learningKind ?? derived.learningKind;
  const targetKey = resolvedTargetKey;
  const deltaType = input.deltaType ?? derived.deltaType;
  const beforeState = input.beforeState ?? derived.beforeState;
  const afterState = input.afterState ?? derived.afterState;
  const explanation = input.explanation ?? derived.explanation;
  const confidence = derived.confidence;

  const existing = await findLearnedDeltaByIdempotencyKey({
    tenantId: input.tenantId,
    outcomeId: outcome.id,
    learningKind,
    targetKey,
  });
  if (existing) {
    return { delta: existing, created: false };
  }

  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const id = randomUUID();
  const insertPayload = {
    id,
    tenantId: input.tenantId,
    goalRunId: outcome.goalRunId,
    cycleId: outcome.cycleId,
    decisionId: outcome.decisionId,
    objectiveId: outcome.objectiveId,
    outcomeId: outcome.id,
    canonicalOperatorId: outcome.canonicalOperatorId,
    operatorUserId: outcome.operatorUserId,
    learningKind,
    targetKey,
    deltaType,
    beforeStateJson: beforeState,
    afterStateJson: afterState,
    evidenceReference: outcome.evidenceReference,
    confidence,
    explanation,
    appliedCount: 1,
  };

  try {
    await db.insert(goalCycleLearnedDeltas).values(insertPayload);
    const created = await getGoalCycleLearnedDelta({
      tenantId: input.tenantId,
      deltaId: id,
    });
    if (!created) throw new Error("Failed to load created learned delta");
    return { delta: created, created: true };
  } catch (error) {
    if (isMysqlDuplicateKeyError(error)) {
      const duplicate = await findLearnedDeltaByIdempotencyKey({
        tenantId: input.tenantId,
        outcomeId: outcome.id,
        learningKind,
        targetKey,
      });
      if (duplicate) return { delta: duplicate, created: false };
    }
    throw error;
  }
}

/**
 * Returns active learned adjustments for future selection and loadout synthesis.
 */
export async function getActiveLearnedLoadoutDeltas(input: {
  tenantId: string;
  canonicalOperatorId?: string;
}): Promise<GoalCycleLearnedDeltaRecord[]> {
  return listGoalCycleLearnedDeltas({
    tenantId: input.tenantId,
    canonicalOperatorId: input.canonicalOperatorId,
    limit: 10,
  });
}
