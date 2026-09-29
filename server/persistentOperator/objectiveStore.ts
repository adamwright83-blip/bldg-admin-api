import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { goalCycleObjectives } from "../../drizzle/schema";
import { getDb } from "../db";
import { isMysqlDuplicateKeyError } from "../mysqlErrors";
import type { ExecutionIntelligenceItem } from "../../shared/executionIntelligence";
import type { GoldlineObjective } from "../../shared/goldlineAdventure";
import type { RankedDayWork } from "../../shared/currentDayLine";
import {
  defaultAuthorityForGoldlineAction,
  type GoldlineAuthority,
} from "../../shared/goldlineActionContract";
import type { ObjectiveExecutionType } from "../../shared/objectiveExecution";
import type { GoalCycleDecisionRecord } from "./decisionStore";
import type { PersistentObligation } from "./obligationStore";
import type { WeeklyGrowthCandidate } from "../../shared/weeklyGrowthCandidates";

export const OBJECTIVE_STATUSES = [
  "presented",
  "accepted",
  "in_progress",
  "action_attempted",
  "action_executed",
  "completed",
  "failed",
  "blocked",
  "cancelled",
] as const;

export type ObjectiveStatus = (typeof OBJECTIVE_STATUSES)[number];

export type PersistentGrowthObjective = {
  id: string;
  tenantId: string;
  goalRunId: string;
  cycleId: string;
  decisionId: string;
  canonicalOperatorId: string;
  operatorUserId: string;
  selectionKind: "candidate" | "obligation";
  selectedRef: string;
  title: string;
  description: string;
  executionType: ObjectiveExecutionType | null;
  authority: GoldlineAuthority;
  status: ObjectiveStatus;
  statusReason: string | null;
  actionTargetType: string | null;
  actionTargetId: string | null;
  actionTargetDisplayName: string | null;
  businessDate: string;
  windowStart: string | null;
  windowEnd: string | null;
  loadout: ExecutionIntelligenceItem[];
  evidenceRefs: string[];
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MaterializeObjectiveInput = {
  tenantId: string;
  decision: GoalCycleDecisionRecord;
  candidate?: WeeklyGrowthCandidate | null;
  obligation?: PersistentObligation | null;
  businessDate?: string;
  now?: Date;
};

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function loadoutItems(value: unknown): ExecutionIntelligenceItem[] {
  return Array.isArray(value) ? (value as ExecutionIntelligenceItem[]) : [];
}

function toRecord(
  row: typeof goalCycleObjectives.$inferSelect
): PersistentGrowthObjective {
  const executionType =
    row.executionType === "mission" ||
    row.executionType === "challenge" ||
    row.executionType === "hybrid_objective"
      ? row.executionType
      : null;
  const authority: GoldlineAuthority =
    row.authority === "AUTO" ||
    row.authority === "AUTO_INFORM" ||
    row.authority === "APPROVAL_REQUIRED" ||
    row.authority === "HUMAN_EXECUTION"
      ? row.authority
      : "HUMAN_EXECUTION";
  const status: ObjectiveStatus = (OBJECTIVE_STATUSES as readonly string[]).includes(
    row.status
  )
    ? (row.status as ObjectiveStatus)
    : "presented";

  return {
    id: row.id,
    tenantId: row.tenantId,
    goalRunId: row.goalRunId,
    cycleId: row.cycleId,
    decisionId: row.decisionId,
    canonicalOperatorId: row.canonicalOperatorId,
    operatorUserId: row.operatorUserId,
    selectionKind: row.selectionKind === "obligation" ? "obligation" : "candidate",
    selectedRef: row.selectedRef,
    title: row.title,
    description: row.description,
    executionType,
    authority,
    status,
    statusReason: row.statusReason,
    actionTargetType: row.actionTargetType,
    actionTargetId: row.actionTargetId,
    actionTargetDisplayName: row.actionTargetDisplayName,
    businessDate: row.businessDate,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    loadout: loadoutItems(row.loadoutJson),
    evidenceRefs: arrayOfStrings(row.evidenceRefsJson),
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getGoalCycleObjective(input: {
  tenantId: string;
  objectiveId: string;
}): Promise<PersistentGrowthObjective | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db
    .select()
    .from(goalCycleObjectives)
    .where(
      and(
        eq(goalCycleObjectives.tenantId, input.tenantId),
        eq(goalCycleObjectives.id, input.objectiveId)
      )
    )
    .limit(1);
  return row ? toRecord(row) : null;
}

export async function getGoalCycleObjectiveByDecision(input: {
  tenantId: string;
  decisionId: string;
}): Promise<PersistentGrowthObjective | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db
    .select()
    .from(goalCycleObjectives)
    .where(
      and(
        eq(goalCycleObjectives.tenantId, input.tenantId),
        eq(goalCycleObjectives.decisionId, input.decisionId)
      )
    )
    .limit(1);
  return row ? toRecord(row) : null;
}

export async function listGoalCycleObjectives(input: {
  tenantId: string;
  canonicalOperatorId?: string;
  goalRunId?: string;
  businessDate?: string;
  status?: ObjectiveStatus;
  limit?: number;
}): Promise<PersistentGrowthObjective[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const where = [eq(goalCycleObjectives.tenantId, input.tenantId)];
  if (input.canonicalOperatorId) {
    where.push(eq(goalCycleObjectives.canonicalOperatorId, input.canonicalOperatorId));
  }
  if (input.goalRunId) {
    where.push(eq(goalCycleObjectives.goalRunId, input.goalRunId));
  }
  if (input.businessDate) {
    where.push(eq(goalCycleObjectives.businessDate, input.businessDate));
  }
  if (input.status) {
    where.push(eq(goalCycleObjectives.status, input.status));
  }

  const rows = await db
    .select()
    .from(goalCycleObjectives)
    .where(and(...where))
    .orderBy(desc(goalCycleObjectives.createdAt))
    .limit(input.limit ?? 50);

  return rows.map(toRecord);
}

function deriveObjectiveContent(input: {
  decision: GoalCycleDecisionRecord;
  candidate?: WeeklyGrowthCandidate | null;
  obligation?: PersistentObligation | null;
  businessDate?: string;
}): {
  title: string;
  description: string;
  executionType: ObjectiveExecutionType | null;
  authority: GoldlineAuthority;
  actionTargetType: string | null;
  actionTargetId: string | null;
  actionTargetDisplayName: string | null;
  businessDate: string;
} {
  const { decision, candidate, obligation } = input;
  const executionType = decision.selectedExecutionType;

  if (decision.selectionKind === "obligation" && obligation) {
    const payload = obligation.payload;
    const actionKind =
      obligation.kind === "sales_follow_up" ? "FOLLOW_UP" : "CALL";
    return {
      title: payload.title || `Follow up: ${payload.subjectName || obligation.subjectKey}`,
      description: payload.why || payload.title || "Open operational obligation due",
      executionType: executionType ?? obligation.executionType ?? "challenge",
      authority: defaultAuthorityForGoldlineAction(actionKind),
      actionTargetType:
        obligation.kind === "sales_follow_up" ? "commercial_account" : "customer",
      actionTargetId: obligation.subjectKey,
      actionTargetDisplayName: payload.subjectName || obligation.subjectKey,
      businessDate: input.businessDate || obligation.dueDate,
    };
  }

  if (candidate) {
    const primaryRef = candidate.sourceRefs[0];
    const isField = executionType === "mission" || executionType === "hybrid_objective";
    const authority = defaultAuthorityForGoldlineAction(isField ? "VISIT" : "FOLLOW_UP");
    return {
      title: candidate.title,
      description: candidate.objective,
      executionType: executionType ?? "mission",
      authority,
      actionTargetType: primaryRef?.sourceType ?? "campaign",
      actionTargetId: primaryRef?.sourceId ?? candidate.id,
      actionTargetDisplayName: candidate.title,
      businessDate:
        input.businessDate ||
        decision.weekStart ||
        new Date().toISOString().slice(0, 10),
    };
  }

  // Fallback when candidate/obligation record is not passed in directly
  const isObligation = decision.selectionKind === "obligation";
  return {
    title: isObligation
      ? `Operational Obligation: ${decision.selectedRef}`
      : `Growth Objective: ${decision.selectedRef}`,
    description: isObligation
      ? "Selected operational obligation requiring operator action"
      : "Selected strategic growth objective",
    executionType,
    authority: "HUMAN_EXECUTION",
    actionTargetType: isObligation ? "obligation" : "candidate",
    actionTargetId: decision.selectedRef,
    actionTargetDisplayName: decision.selectedRef,
    businessDate:
      input.businessDate ||
      decision.weekStart ||
      new Date().toISOString().slice(0, 10),
  };
}

export async function materializeGoalCycleObjective(
  input: MaterializeObjectiveInput
): Promise<{ objective: PersistentGrowthObjective; created: boolean }> {
  if (input.decision.selectionKind === "wait") {
    throw new Error("Cannot materialize objective for a wait decision");
  }

  const existing = await getGoalCycleObjectiveByDecision({
    tenantId: input.tenantId,
    decisionId: input.decision.id,
  });
  if (existing) {
    return { objective: existing, created: false };
  }

  const content = deriveObjectiveContent(input);
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const id = randomUUID();
  const insertPayload = {
    id,
    tenantId: input.tenantId,
    goalRunId: input.decision.goalRunId,
    cycleId: input.decision.cycleId,
    decisionId: input.decision.id,
    canonicalOperatorId: input.decision.canonicalOperatorId,
    operatorUserId: input.decision.operatorUserId,
    selectionKind: input.decision.selectionKind,
    selectedRef: input.decision.selectedRef ?? "",
    title: content.title,
    description: content.description,
    executionType: content.executionType,
    authority: content.authority,
    status: "presented" as const,
    statusReason: null,
    actionTargetType: content.actionTargetType,
    actionTargetId: content.actionTargetId,
    actionTargetDisplayName: content.actionTargetDisplayName,
    businessDate: content.businessDate,
    windowStart: null,
    windowEnd: null,
    loadoutJson: input.decision.loadout,
    evidenceRefsJson: input.decision.evidenceRefs,
    completedAt: null,
  };

  try {
    await db.insert(goalCycleObjectives).values(insertPayload);
    const created = await getGoalCycleObjective({ tenantId: input.tenantId, objectiveId: id });
    if (!created) throw new Error("Failed to read created objective");
    return { objective: created, created: true };
  } catch (error) {
    if (isMysqlDuplicateKeyError(error)) {
      const duplicate = await getGoalCycleObjectiveByDecision({
        tenantId: input.tenantId,
        decisionId: input.decision.id,
      });
      if (duplicate) return { objective: duplicate, created: false };
    }
    throw error;
  }
}

export async function transitionObjectiveStatus(input: {
  tenantId: string;
  objectiveId: string;
  toStatus: ObjectiveStatus;
  statusReason?: string | null;
  completedAt?: Date | null;
  now?: Date;
}): Promise<PersistentGrowthObjective> {
  const current = await getGoalCycleObjective({
    tenantId: input.tenantId,
    objectiveId: input.objectiveId,
  });
  if (!current) throw new Error(`Objective ${input.objectiveId} not found`);

  // Terminal states cannot silently revert to open
  const terminalStates = new Set<ObjectiveStatus>(["completed", "failed", "cancelled"]);
  if (terminalStates.has(current.status) && !terminalStates.has(input.toStatus)) {
    throw new Error(
      `Cannot transition objective from terminal status '${current.status}' to '${input.toStatus}'`
    );
  }

  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const now = input.now ?? new Date();
  const completedAt =
    input.toStatus === "completed"
      ? (input.completedAt ?? now)
      : null;

  await db
    .update(goalCycleObjectives)
    .set({
      status: input.toStatus,
      statusReason: input.statusReason ?? current.statusReason,
      completedAt,
    })
    .where(
      and(
        eq(goalCycleObjectives.tenantId, input.tenantId),
        eq(goalCycleObjectives.id, input.objectiveId)
      )
    );

  const updated = await getGoalCycleObjective({
    tenantId: input.tenantId,
    objectiveId: input.objectiveId,
  });
  if (!updated) throw new Error("Failed to load updated objective");
  return updated;
}

/**
 * Projects a PersistentGrowthObjective into Goldline's playable adventure model
 * without duplicating records.
 */
export function projectToGoldlineObjective(
  objective: PersistentGrowthObjective
): GoldlineObjective {
  const isField = objective.executionType === "mission" || objective.executionType === "hybrid_objective";
  const kind =
    objective.actionTargetType === "customer"
      ? "recovery"
      : isField
        ? "commercial_visit"
        : "follow_up";

  const status =
    objective.status === "completed"
      ? "completed"
      : objective.status === "blocked"
        ? "blocked"
        : "ready";

  return {
    id: objective.id,
    physicalEntityId: objective.actionTargetId,
    kind,
    authority: "persisted_task",
    status,
    latitude: null,
    longitude: null,
    windowStart: objective.windowStart,
    windowEnd: objective.windowEnd,
    priority: isField ? 10 : 8,
    explanation: objective.title,
    sourceEvidenceReference: `goal_cycle_decisions:${objective.decisionId}`,
  };
}

/**
 * Projects a PersistentGrowthObjective into Day Line ranked work.
 */
export function projectToRankedDayWork(
  objective: PersistentGrowthObjective
): RankedDayWork {
  return {
    id: objective.id,
    title: objective.title,
    objective: objective.description,
    completionCondition: objective.description,
    executionType: objective.executionType,
  };
}
