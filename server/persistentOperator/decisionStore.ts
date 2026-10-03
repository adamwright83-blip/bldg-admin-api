import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import { goalCycleDecisions } from "../../drizzle/schema";
import type { ExecutionIntelligenceItem } from "../../shared/executionIntelligence";
import type { ObjectiveExecutionType } from "../../shared/objectiveExecution";
import { getDb } from "../db";
import { isMysqlDuplicateKeyError } from "../mysqlErrors";

export type GoalCycleSelectionKind = "candidate" | "obligation" | "wait";

export type BlockedCycleCandidate = {
  id: string;
  reasons: string[];
};

export type GoalCycleDecisionDraft = {
  tenantId: string;
  goalRunId: string;
  cycleId: string;
  canonicalOperatorId: string;
  operatorUserId: string;
  policyVersion: string;
  weeklyIntentId: string | null;
  weeklyIntentRevision: number | null;
  weekStart: string | null;
  candidateFingerprint: string | null;
  candidateIds: string[];
  candidateReasonCodes: Record<string, string[]>;
  missionDirectorPlanId: string | null;
  missionDirectorRevision: number | null;
  selectionKind: GoalCycleSelectionKind;
  selectedRef: string | null;
  selectedExecutionType: ObjectiveExecutionType | null;
  selectedReasonCode: string;
  evidenceRefs: string[];
  blockedCandidates: BlockedCycleCandidate[];
  priorComparableDecisionId: string | null;
  sourceCoverage: unknown;
  loadout: ExecutionIntelligenceItem[];
  experiment: unknown | null;
};

export type GoalCycleDecisionRecord = GoalCycleDecisionDraft & {
  id: string;
  decisionFingerprint: string;
  createdAt: string;
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = stable((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function goalCycleDecisionFingerprint(
  draft: GoalCycleDecisionDraft
): string {
  return createHash("sha256")
    .update(JSON.stringify(stable(draft)))
    .digest("hex");
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function reasonMap(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string[]> = {};
  for (const [key, reasons] of Object.entries(value as Record<string, unknown>)) {
    out[key] = arrayOfStrings(reasons);
  }
  return out;
}

function blocked(value: unknown): BlockedCycleCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    return typeof record.id === "string"
      ? [{ id: record.id, reasons: arrayOfStrings(record.reasons) }]
      : [];
  });
}

function loadout(value: unknown): ExecutionIntelligenceItem[] {
  return Array.isArray(value) ? (value as ExecutionIntelligenceItem[]) : [];
}

function toRecord(
  row: typeof goalCycleDecisions.$inferSelect
): GoalCycleDecisionRecord {
  const executionType =
    row.selectedExecutionType === "mission" ||
    row.selectedExecutionType === "challenge" ||
    row.selectedExecutionType === "hybrid_objective"
      ? row.selectedExecutionType
      : null;
  const selectionKind =
    row.selectionKind === "candidate" ||
    row.selectionKind === "obligation" ||
    row.selectionKind === "wait"
      ? row.selectionKind
      : "wait";
  return {
    id: row.id,
    tenantId: row.tenantId,
    goalRunId: row.goalRunId,
    cycleId: row.cycleId,
    canonicalOperatorId: row.canonicalOperatorId,
    operatorUserId: row.operatorUserId,
    policyVersion: row.policyVersion,
    weeklyIntentId: row.weeklyIntentId,
    weeklyIntentRevision: row.weeklyIntentRevision,
    weekStart: row.weekStart,
    candidateFingerprint: row.candidateFingerprint,
    candidateIds: arrayOfStrings(row.candidateIdsJson),
    candidateReasonCodes: reasonMap(row.candidateReasonCodesJson),
    missionDirectorPlanId: row.missionDirectorPlanId,
    missionDirectorRevision: row.missionDirectorRevision,
    selectionKind,
    selectedRef: row.selectedRef,
    selectedExecutionType: executionType,
    selectedReasonCode: row.selectedReasonCode,
    evidenceRefs: arrayOfStrings(row.evidenceRefsJson),
    blockedCandidates: blocked(row.blockedCandidatesJson),
    priorComparableDecisionId: row.priorComparableDecisionId,
    sourceCoverage: row.sourceCoverageJson,
    loadout: loadout(row.loadoutJson),
    experiment: row.experimentJson ?? null,
    decisionFingerprint: row.decisionFingerprint,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getGoalCycleDecision(input: {
  tenantId: string;
  decisionId: string;
}): Promise<GoalCycleDecisionRecord | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db
    .select()
    .from(goalCycleDecisions)
    .where(
      and(
        eq(goalCycleDecisions.tenantId, input.tenantId),
        eq(goalCycleDecisions.id, input.decisionId)
      )
    )
    .limit(1);
  return row ? toRecord(row) : null;
}

export async function findDecisionForCycle(input: {
  tenantId: string;
  cycleId: string;
}): Promise<GoalCycleDecisionRecord | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db
    .select()
    .from(goalCycleDecisions)
    .where(
      and(
        eq(goalCycleDecisions.tenantId, input.tenantId),
        eq(goalCycleDecisions.cycleId, input.cycleId)
      )
    )
    .limit(1);
  return row ? toRecord(row) : null;
}

export async function findPriorComparableDecision(input: {
  tenantId: string;
  goalRunId: string;
  selectionKind: GoalCycleSelectionKind;
  selectedRef: string | null;
  excludeCycleId: string;
}): Promise<GoalCycleDecisionRecord | null> {
  if (!input.selectedRef) return null;
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db
    .select()
    .from(goalCycleDecisions)
    .where(
      and(
        eq(goalCycleDecisions.tenantId, input.tenantId),
        eq(goalCycleDecisions.goalRunId, input.goalRunId),
        eq(goalCycleDecisions.selectionKind, input.selectionKind),
        eq(goalCycleDecisions.selectedRef, input.selectedRef),
        ne(goalCycleDecisions.cycleId, input.excludeCycleId)
      )
    )
    .orderBy(desc(goalCycleDecisions.createdAt))
    .limit(1);
  return row ? toRecord(row) : null;
}

export async function appendGoalCycleDecision(
  draft: GoalCycleDecisionDraft
): Promise<{ decision: GoalCycleDecisionRecord; created: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const fingerprint = goalCycleDecisionFingerprint(draft);
  const existing = await findDecisionForCycle({
    tenantId: draft.tenantId,
    cycleId: draft.cycleId,
  });
  if (existing) {
    if (existing.decisionFingerprint !== fingerprint) {
      throw new Error("Goal cycle already has a different append-only decision");
    }
    return { decision: existing, created: false };
  }

  const id = randomUUID();
  try {
    await db.insert(goalCycleDecisions).values({
      id,
      tenantId: draft.tenantId,
      goalRunId: draft.goalRunId,
      cycleId: draft.cycleId,
      canonicalOperatorId: draft.canonicalOperatorId,
      operatorUserId: draft.operatorUserId,
      policyVersion: draft.policyVersion,
      weeklyIntentId: draft.weeklyIntentId,
      weeklyIntentRevision: draft.weeklyIntentRevision,
      weekStart: draft.weekStart,
      candidateFingerprint: draft.candidateFingerprint,
      candidateIdsJson: draft.candidateIds,
      candidateReasonCodesJson: draft.candidateReasonCodes,
      missionDirectorPlanId: draft.missionDirectorPlanId,
      missionDirectorRevision: draft.missionDirectorRevision,
      selectionKind: draft.selectionKind,
      selectedRef: draft.selectedRef,
      selectedExecutionType: draft.selectedExecutionType,
      selectedReasonCode: draft.selectedReasonCode,
      evidenceRefsJson: draft.evidenceRefs,
      blockedCandidatesJson: draft.blockedCandidates,
      priorComparableDecisionId: draft.priorComparableDecisionId,
      sourceCoverageJson: draft.sourceCoverage,
      loadoutJson: draft.loadout,
      experimentJson: draft.experiment,
      decisionFingerprint: fingerprint,
    });
  } catch (error) {
    if (!isMysqlDuplicateKeyError(error)) throw error;
    const raced = await findDecisionForCycle({
      tenantId: draft.tenantId,
      cycleId: draft.cycleId,
    });
    if (!raced || raced.decisionFingerprint !== fingerprint) {
      throw new Error("Goal cycle decision idempotency conflict");
    }
    return { decision: raced, created: false };
  }
  const decision = await getGoalCycleDecision({
    tenantId: draft.tenantId,
    decisionId: id,
  });
  if (!decision) throw new Error("Persisted goal cycle decision could not be reloaded");
  return { decision, created: true };
}
