import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  macroGoalRuns,
  type MacroGoalRun as MacroGoalRunRow,
} from "../../drizzle/schema";
import {
  getActiveMacroGoalForOperators,
  type MacroGoal,
} from "../claire/macroGoalService";
import { getDb } from "../db";
import type { VerticalRegistry } from "../strategy/verticalTemplates/registry";
import type { CanonicalOperatorIdentity } from "./identity";

export const METRIC_PRECISIONS = [
  "exact",
  "recorded_only",
  "platform_reported",
  "missing",
  "conflicting",
] as const;
export type MetricPrecision = (typeof METRIC_PRECISIONS)[number];

export const METRIC_COVERAGES = [
  "complete",
  "partial",
  "stale",
  "unavailable",
  "missing",
  "conflicting",
] as const;
export type MetricCoverage = (typeof METRIC_COVERAGES)[number];

export type AuthoritativeMetricObservation = {
  value: number | null;
  observationRef: string | null;
  precision: MetricPrecision;
  coverage: MetricCoverage;
  observedAt: string;
};

export type MacroGoalRunStatus =
  | "active"
  | "paused"
  | "completed"
  | "superseded";

export type MacroGoalRun = Omit<MacroGoalRunRow, "targetValue" | "baselineValue"> & {
  targetValue: number;
  baselineValue: number | null;
};

export type CreateMacroGoalRunInput = {
  id: string;
  tenantId: string;
  canonicalOperatorId: string;
  operatorUserId: string;
  macroGoalId: string;
  verticalKey: string;
  goalSnapshotJson: Record<string, unknown>;
  metricKey: string;
  targetValue: number;
  unit: string;
  baselineObservationRef: string | null;
  baselineValue: number | null;
  baselinePrecision: MetricPrecision;
  baselineCoverage: MetricCoverage;
  startedAt: Date;
  nextEvaluationAt: Date | null;
  policyVersion: string;
};

export type MacroGoalRunPersistence = {
  createOrGet(input: CreateMacroGoalRunInput): Promise<MacroGoalRunRow>;
  get(input: { tenantId: string; id: string }): Promise<MacroGoalRunRow | null>;
  recordEvaluation(input: {
    tenantId: string;
    id: string;
    evaluatedAt: Date;
    nextEvaluationAt: Date | null;
    completeWithEvidenceRef?: string | null;
  }): Promise<MacroGoalRunRow | null>;
  setStatus(input: {
    tenantId: string;
    id: string;
    status: Exclude<MacroGoalRunStatus, "completed">;
    nextEvaluationAt?: Date | null;
  }): Promise<MacroGoalRunRow | null>;
};

function normalizeRun(row: MacroGoalRunRow | null): MacroGoalRun | null {
  if (!row) return null;
  return {
    ...row,
    targetValue: Number(row.targetValue),
    baselineValue: row.baselineValue == null ? null : Number(row.baselineValue),
  };
}

function metricPrecision(value: unknown): MetricPrecision | null {
  return typeof value === "string" &&
    (METRIC_PRECISIONS as readonly string[]).includes(value)
    ? (value as MetricPrecision)
    : null;
}

function metricCoverage(value: unknown): MetricCoverage | null {
  return typeof value === "string" &&
    (METRIC_COVERAGES as readonly string[]).includes(value)
    ? (value as MetricCoverage)
    : null;
}

/**
 * Metric readers are deliberately fail-closed. A random object with a numeric
 * value is not enough to complete a goal; it must carry explicit truth quality,
 * coverage and evidence identity.
 */
export function parseAuthoritativeMetricObservation(
  value: unknown
): AuthoritativeMetricObservation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Authoritative metric reader returned an invalid observation");
  }
  const row = value as Record<string, unknown>;
  const precision = metricPrecision(row.precision);
  const coverage = metricCoverage(row.coverage);
  const numeric =
    row.value === null
      ? null
      : typeof row.value === "number" && Number.isFinite(row.value)
        ? row.value
        : null;
  if (row.value !== null && numeric === null) {
    throw new Error("Authoritative metric observation value must be finite or null");
  }
  if (!precision || !coverage) {
    throw new Error("Authoritative metric observation is missing precision or coverage");
  }
  const observationRef =
    row.observationRef === null
      ? null
      : typeof row.observationRef === "string" && row.observationRef.trim()
        ? row.observationRef.trim()
        : null;
  if (row.observationRef !== null && observationRef === null) {
    throw new Error("Authoritative metric observation reference is invalid");
  }
  if (typeof row.observedAt !== "string" || !Number.isFinite(Date.parse(row.observedAt))) {
    throw new Error("Authoritative metric observation timestamp is invalid");
  }
  return {
    value: numeric,
    observationRef,
    precision,
    coverage,
    observedAt: new Date(row.observedAt).toISOString(),
  };
}

export function observationSupportsCompletion(input: {
  observation: AuthoritativeMetricObservation;
  targetValue: number;
}): boolean {
  return (
    input.observation.value !== null &&
    input.observation.precision === "exact" &&
    input.observation.coverage === "complete" &&
    input.observation.observationRef !== null &&
    input.observation.value >= input.targetValue
  );
}

function goalSnapshot(goal: MacroGoal): Record<string, unknown> {
  return {
    id: goal.id,
    tenantId: goal.tenantId,
    operatorUserId: goal.operatorUserId,
    objective: goal.objective,
    metricKey: goal.metricKey,
    targetValue: goal.targetValue,
    unit: goal.unit,
    urgencyText: goal.urgencyText,
    targetDate: goal.targetDate,
    source: goal.source,
    sourceNote: goal.sourceNote,
    secondaryTargets: goal.secondaryTargets ?? null,
    status: goal.status,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
  };
}

const databasePersistence: MacroGoalRunPersistence = {
  async createOrGet(input) {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    return db.transaction(
      async tx => {
        const [existing] = await tx
          .select()
          .from(macroGoalRuns)
          .where(
            and(
              eq(macroGoalRuns.tenantId, input.tenantId),
              eq(macroGoalRuns.macroGoalId, input.macroGoalId)
            )
          )
          .for("update")
          .limit(1);
        if (existing) return existing;

        // A newly activated macro goal supersedes older non-terminal runs for
        // the same canonical operator + metric. Historical rows remain intact.
        await tx
          .update(macroGoalRuns)
          .set({
            status: "superseded",
            nextEvaluationAt: null,
          })
          .where(
            and(
              eq(macroGoalRuns.tenantId, input.tenantId),
              eq(macroGoalRuns.canonicalOperatorId, input.canonicalOperatorId),
              eq(macroGoalRuns.metricKey, input.metricKey),
              inArray(macroGoalRuns.status, ["active", "paused"])
            )
          );

        await tx.insert(macroGoalRuns).values({
          id: input.id,
          tenantId: input.tenantId,
          canonicalOperatorId: input.canonicalOperatorId,
          operatorUserId: input.operatorUserId,
          macroGoalId: input.macroGoalId,
          verticalKey: input.verticalKey,
          status: "active",
          goalSnapshotJson: input.goalSnapshotJson,
          metricKey: input.metricKey,
          targetValue: input.targetValue.toFixed(2),
          unit: input.unit,
          baselineObservationRef: input.baselineObservationRef,
          baselineValue:
            input.baselineValue == null ? null : input.baselineValue.toFixed(2),
          baselinePrecision: input.baselinePrecision,
          baselineCoverage: input.baselineCoverage,
          startedAt: input.startedAt,
          nextEvaluationAt: input.nextEvaluationAt,
          policyVersion: input.policyVersion,
        });
        const [saved] = await tx
          .select()
          .from(macroGoalRuns)
          .where(
            and(
              eq(macroGoalRuns.tenantId, input.tenantId),
              eq(macroGoalRuns.id, input.id)
            )
          )
          .limit(1);
        if (!saved) throw new Error("Macro goal run insert was not readable");
        return saved;
      },
      { isolationLevel: "serializable" }
    );
  },

  async get(input) {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    const [row] = await db
      .select()
      .from(macroGoalRuns)
      .where(
        and(
          eq(macroGoalRuns.tenantId, input.tenantId),
          eq(macroGoalRuns.id, input.id)
        )
      )
      .limit(1);
    return row ?? null;
  },

  async recordEvaluation(input) {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    const completionEvidenceRef = input.completeWithEvidenceRef?.trim() || null;
    await db
      .update(macroGoalRuns)
      .set(
        completionEvidenceRef
          ? {
              status: "completed",
              lastEvaluatedAt: input.evaluatedAt,
              nextEvaluationAt: null,
              completedAt: input.evaluatedAt,
              completionEvidenceRef,
            }
          : {
              lastEvaluatedAt: input.evaluatedAt,
              nextEvaluationAt: input.nextEvaluationAt,
            }
      )
      .where(
        and(
          eq(macroGoalRuns.tenantId, input.tenantId),
          eq(macroGoalRuns.id, input.id),
          eq(macroGoalRuns.status, "active")
        )
      );
    return this.get(input);
  },

  async setStatus(input) {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    const allowedFrom =
      input.status === "active"
        ? ["paused"] as const
        : input.status === "paused"
          ? ["active"] as const
          : ["active", "paused"] as const;
    const result = await db
      .update(macroGoalRuns)
      .set({
        status: input.status,
        nextEvaluationAt:
          input.status === "active"
            ? (input.nextEvaluationAt ?? new Date())
            : null,
      })
      .where(
        and(
          eq(macroGoalRuns.tenantId, input.tenantId),
          eq(macroGoalRuns.id, input.id),
          inArray(macroGoalRuns.status, [...allowedFrom])
        )
      );
    const affected = Number(
      (result as { [0]?: { affectedRows?: number } })[0]?.affectedRows ?? 0
    );
    if (affected !== 1) return null;
    return this.get(input);
  },
};

function operatorAliases(identity: CanonicalOperatorIdentity): string[] {
  return [
    ...new Set([
      identity.canonicalOpenId,
      identity.sourceOpenId,
      ...identity.aliases.map(alias => alias.openId),
    ]),
  ];
}

export async function activateCurrentMacroGoalRun(input: {
  tenantId: string;
  identity: CanonicalOperatorIdentity;
  verticalKey: string;
  policyVersion: string;
  now?: Date;
  registry: VerticalRegistry;
  persistence?: MacroGoalRunPersistence;
}): Promise<MacroGoalRun | null> {
  if (input.identity.tenantId !== input.tenantId) {
    throw new Error("Canonical operator identity tenant mismatch");
  }
  const goal = await getActiveMacroGoalForOperators({
    tenantId: input.tenantId,
    operatorUserIds: operatorAliases(input.identity),
  });
  if (!goal) return null;
  return activateMacroGoalRun({
    ...input,
    goal,
  });
}

export async function activateMacroGoalRun(input: {
  tenantId: string;
  identity: CanonicalOperatorIdentity;
  verticalKey: string;
  policyVersion: string;
  goal: MacroGoal;
  now?: Date;
  registry: VerticalRegistry;
  persistence?: MacroGoalRunPersistence;
}): Promise<MacroGoalRun> {
  const now = input.now ?? new Date();
  const registry = input.registry;
  const persistence = input.persistence ?? databasePersistence;
  if (input.identity.tenantId !== input.tenantId || input.goal.tenantId !== input.tenantId) {
    throw new Error("Macro goal activation tenant mismatch");
  }
  if (!operatorAliases(input.identity).includes(input.goal.operatorUserId)) {
    throw new Error("Macro goal is not owned by the canonical operator family");
  }

  const resolved = registry.resolveMetric(input.verticalKey, input.goal.metricKey);
  const baseline = parseAuthoritativeMetricObservation(
    await resolved.reader({ tenantId: input.tenantId, asOf: now })
  );

  const saved = await persistence.createOrGet({
    id: randomUUID(),
    tenantId: input.tenantId,
    canonicalOperatorId: input.identity.canonicalOperatorId,
    operatorUserId: input.identity.canonicalOpenId,
    macroGoalId: input.goal.id,
    verticalKey: input.verticalKey,
    goalSnapshotJson: goalSnapshot(input.goal),
    metricKey: input.goal.metricKey,
    targetValue: input.goal.targetValue,
    unit: input.goal.unit,
    baselineObservationRef: baseline.observationRef,
    baselineValue: baseline.value,
    baselinePrecision: baseline.precision,
    baselineCoverage: baseline.coverage,
    startedAt: now,
    nextEvaluationAt: now,
    policyVersion: input.policyVersion,
  });
  return normalizeRun(saved)!;
}

export async function evaluateMacroGoalRun(input: {
  tenantId: string;
  runId: string;
  now?: Date;
  registry: VerticalRegistry;
  persistence?: MacroGoalRunPersistence;
  nextEvaluationAt?: Date | null;
}): Promise<{
  run: MacroGoalRun;
  observation: AuthoritativeMetricObservation;
  completed: boolean;
}> {
  const now = input.now ?? new Date();
  const registry = input.registry;
  const persistence = input.persistence ?? databasePersistence;
  const current = normalizeRun(
    await persistence.get({ tenantId: input.tenantId, id: input.runId })
  );
  if (!current) throw new Error("Macro goal run not found");
  if (current.tenantId !== input.tenantId) throw new Error("Macro goal run tenant mismatch");

  const resolved = registry.resolveMetric(current.verticalKey, current.metricKey);
  const observation = parseAuthoritativeMetricObservation(
    await resolved.reader({ tenantId: input.tenantId, asOf: now })
  );
  const complete =
    current.status === "active" &&
    observationSupportsCompletion({
      observation,
      targetValue: current.targetValue,
    });

  const updated = normalizeRun(
    await persistence.recordEvaluation({
      tenantId: input.tenantId,
      id: input.runId,
      evaluatedAt: now,
      nextEvaluationAt:
        complete
          ? null
          : (input.nextEvaluationAt ?? new Date(now.getTime() + 60 * 60 * 1000)),
      completeWithEvidenceRef: complete ? observation.observationRef : null,
    })
  );
  if (!updated) throw new Error("Macro goal run disappeared during evaluation");

  return {
    run: updated,
    observation,
    completed: updated.status === "completed",
  };
}

export async function pauseMacroGoalRun(input: {
  tenantId: string;
  runId: string;
  persistence?: MacroGoalRunPersistence;
}): Promise<MacroGoalRun> {
  const persistence = input.persistence ?? databasePersistence;
  const updated = normalizeRun(
    await persistence.setStatus({
      tenantId: input.tenantId,
      id: input.runId,
      status: "paused",
    })
  );
  if (!updated) throw new Error("Macro goal run not found");
  return updated;
}

export async function resumeMacroGoalRun(input: {
  tenantId: string;
  runId: string;
  now?: Date;
  persistence?: MacroGoalRunPersistence;
}): Promise<MacroGoalRun> {
  const persistence = input.persistence ?? databasePersistence;
  const updated = normalizeRun(
    await persistence.setStatus({
      tenantId: input.tenantId,
      id: input.runId,
      status: "active",
      nextEvaluationAt: input.now ?? new Date(),
    })
  );
  if (!updated) throw new Error("Macro goal run not found");
  return updated;
}

export async function supersedeMacroGoalRun(input: {
  tenantId: string;
  runId: string;
  persistence?: MacroGoalRunPersistence;
}): Promise<MacroGoalRun> {
  const persistence = input.persistence ?? databasePersistence;
  const updated = normalizeRun(
    await persistence.setStatus({
      tenantId: input.tenantId,
      id: input.runId,
      status: "superseded",
    })
  );
  if (!updated) throw new Error("Macro goal run not found");
  return updated;
}
