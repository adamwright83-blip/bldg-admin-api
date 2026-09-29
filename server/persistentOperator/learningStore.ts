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
 * Derives the deterministic learned delta from an authoritative outcome record.
 * Crucially: learning = f(authoritative receipts and outcomes), NOT model opinion.
 */
function deriveDeterministicLearning(outcome: GoalCycleOutcomeRecord): {
  learningKind: LearningKind;
  targetKey: string;
  deltaType: DeltaType;
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
  explanation: string;
} {
  if (outcome.impactClass === "commercial_revenue" && outcome.monetaryValueCents != null) {
    const revenueDollars = (outcome.monetaryValueCents / 100).toFixed(2);
    return {
      learningKind: "doctrine_weight",
      targetKey: outcome.outcomeKind,
      deltaType: "boost",
      beforeState: { doctrineWeight: 1.0 },
      afterState: {
        doctrineWeight: 1.5,
        verifiedRevenueCents: outcome.monetaryValueCents,
        sourceSystem: outcome.sourceSystem,
      },
      explanation: `Verified commercial revenue of $${revenueDollars} via ${outcome.sourceSystem}; boosting execution doctrine '${outcome.outcomeKind}'.`,
    };
  }

  if (outcome.impactClass === "action_verification") {
    return {
      learningKind: "channel_affinity",
      targetKey: outcome.sourceSystem,
      deltaType: "reinforce",
      beforeState: { verifiedDeliveries: 0 },
      afterState: {
        verifiedDeliveries: 1,
        sourceSystem: outcome.sourceSystem,
        evidenceRef: outcome.evidenceReference,
      },
      explanation: `Action execution verified via ${outcome.sourceSystem}; reinforcing channel affinity.`,
    };
  }

  if (outcome.epistemicStatus === "rejected" || outcome.outcomeKind.includes("failed") || outcome.outcomeKind.includes("blocked")) {
    return {
      learningKind: "execution_constraint",
      targetKey: outcome.outcomeKind,
      deltaType: "suppress",
      beforeState: { constrained: false },
      afterState: {
        constrained: true,
        reason: outcome.explanation ?? "Action execution blocked or failed",
      },
      explanation: `Execution failure recorded for '${outcome.outcomeKind}'; constraining future recurrence until conditions change.`,
    };
  }

  return {
    learningKind: "loadout_recommendation",
    targetKey: outcome.outcomeKind,
    deltaType: "boost",
    beforeState: { priority: "normal" },
    afterState: {
      priority: "elevated",
      sourceSystem: outcome.sourceSystem,
    },
    explanation: `Operational outcome '${outcome.outcomeKind}' verified; elevating loadout priority for matching context.`,
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

  const derived = deriveDeterministicLearning(outcome);
  const learningKind = input.learningKind ?? derived.learningKind;
  const targetKey = input.targetKey ?? derived.targetKey;
  const deltaType = input.deltaType ?? derived.deltaType;
  const beforeState = input.beforeState ?? derived.beforeState;
  const afterState = input.afterState ?? derived.afterState;
  const explanation = input.explanation ?? derived.explanation;

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
    confidence: "high" as const,
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
