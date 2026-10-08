import { and, desc, eq } from "drizzle-orm";
import { macroGoalRuns } from "../../../drizzle/schema";
import type { VerticalRegistry } from "../../strategy/verticalTemplates/registry";
import {
  resolveCanonicalOperatorIdentity,
  type CanonicalOperatorIdentity,
} from "./identity";
import {
  activateCurrentMacroGoalRun,
  evaluateMacroGoalRun,
  pauseMacroGoalRun,
  resumeMacroGoalRun,
  type MacroGoalRun,
  type MacroGoalRunPersistence,
} from "./macroGoalRuns";
import {
  createDefaultGoalCycleStore,
  type GoalCycleStore,
  type GoalCycleTrigger,
} from "./goalCycleStore";
import { getDb } from "../../db";

export type GoalCycleEnqueuer = Pick<GoalCycleStore, "enqueue">;

export async function activateMacroGoalAndQueue(input: {
  tenantId: string;
  identity: CanonicalOperatorIdentity;
  verticalKey: string;
  policyVersion: string;
  now?: Date;
  registry: VerticalRegistry;
  runPersistence?: MacroGoalRunPersistence;
  cycleStore?: GoalCycleEnqueuer;
}): Promise<{ run: MacroGoalRun; cycleId: string; cycleCreated: boolean } | null> {
  const run = await activateCurrentMacroGoalRun({
    tenantId: input.tenantId,
    identity: input.identity,
    verticalKey: input.verticalKey,
    policyVersion: input.policyVersion,
    now: input.now,
    registry: input.registry,
    persistence: input.runPersistence,
  });
  if (!run) return null;

  const store = input.cycleStore ?? createDefaultGoalCycleStore();
  const cycle = await store.enqueue({
    tenantId: input.tenantId,
    goalRunId: run.id,
    triggerType: "goal_activated",
    triggerSourceReference: `operator_macro_goals:${run.macroGoalId}`,
    idempotencyKey: `goal_activated:${run.macroGoalId}`,
    availableAt: input.now ?? new Date(),
  });
  return { run, cycleId: cycle.id, cycleCreated: cycle.created };
}

export async function enqueueGoalCycle(input: {
  tenantId: string;
  goalRunId: string;
  triggerType: GoalCycleTrigger;
  triggerSourceReference?: string | null;
  idempotencyKey: string;
  availableAt?: Date;
  deadlineAt?: Date | null;
  maxAttempts?: number;
  cycleStore?: GoalCycleEnqueuer;
}) {
  const store = input.cycleStore ?? createDefaultGoalCycleStore();
  return store.enqueue({
    tenantId: input.tenantId,
    goalRunId: input.goalRunId,
    triggerType: input.triggerType,
    triggerSourceReference: input.triggerSourceReference,
    idempotencyKey: input.idempotencyKey,
    availableAt: input.availableAt,
    deadlineAt: input.deadlineAt,
    maxAttempts: input.maxAttempts,
  });
}

export async function findActiveMacroGoalRun(input: {
  tenantId: string;
  canonicalOperatorId: string;
}): Promise<MacroGoalRun | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db
    .select()
    .from(macroGoalRuns)
    .where(
      and(
        eq(macroGoalRuns.tenantId, input.tenantId),
        eq(macroGoalRuns.canonicalOperatorId, input.canonicalOperatorId),
        eq(macroGoalRuns.status, "active")
      )
    )
    .orderBy(desc(macroGoalRuns.startedAt))
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    targetValue: Number(row.targetValue),
    baselineValue: row.baselineValue == null ? null : Number(row.baselineValue),
  };
}

export async function pauseMacroGoalAndRetainQueue(input: {
  tenantId: string;
  runId: string;
  runPersistence?: MacroGoalRunPersistence;
}) {
  return pauseMacroGoalRun({
    tenantId: input.tenantId,
    runId: input.runId,
    persistence: input.runPersistence,
  });
}

export async function resumeMacroGoalAndQueue(input: {
  tenantId: string;
  runId: string;
  now?: Date;
  runPersistence?: MacroGoalRunPersistence;
  cycleStore?: GoalCycleEnqueuer;
}) {
  const now = input.now ?? new Date();
  const run = await resumeMacroGoalRun({
    tenantId: input.tenantId,
    runId: input.runId,
    now,
    persistence: input.runPersistence,
  });
  const store = input.cycleStore ?? createDefaultGoalCycleStore();
  const cycle = await store.enqueue({
    tenantId: input.tenantId,
    goalRunId: input.runId,
    triggerType: "manual_replan",
    triggerSourceReference: `macro_goal_runs:${input.runId}:resume`,
    idempotencyKey: `resume:${input.runId}:${now.toISOString()}`,
    availableAt: now,
  });
  return { run, cycle };
}

export async function enqueueDurableTriggerForOperator(input: {
  tenantId: string;
  operatorOpenId: string;
  triggerType: GoalCycleTrigger;
  triggerSourceReference: string;
  idempotencyKey: string;
  availableAt?: Date;
  cycleStore?: GoalCycleEnqueuer;
}): Promise<
  | { queued: true; cycleId: string; created: boolean; goalRunId: string }
  | { queued: false; reason: "identity_unresolved" | "identity_ambiguous" | "no_active_goal_run" }
> {
  const identity = await resolveCanonicalOperatorIdentity({
    tenantId: input.tenantId,
    source: { type: "open_id", value: input.operatorOpenId },
    subsystem: "persistent_operator.durable_trigger",
  });
  if (!identity.ok) return { queued: false, reason: identity.reason };
  const run = await findActiveMacroGoalRun({
    tenantId: input.tenantId,
    canonicalOperatorId: identity.identity.canonicalOperatorId,
  });
  if (!run) return { queued: false, reason: "no_active_goal_run" };
  const store = input.cycleStore ?? createDefaultGoalCycleStore();
  const cycle = await store.enqueue({
    tenantId: input.tenantId,
    goalRunId: run.id,
    triggerType: input.triggerType,
    triggerSourceReference: input.triggerSourceReference,
    idempotencyKey: input.idempotencyKey,
    availableAt: input.availableAt,
  });
  return {
    queued: true,
    cycleId: cycle.id,
    created: cycle.created,
    goalRunId: run.id,
  };
}

export function durableTriggerShadowEnabled(): boolean {
  return process.env.PERSISTENT_OPERATOR_DURABLE_TRIGGER_SHADOW === "1";
}

export async function evaluateMacroGoalRunAndScheduleNext(input: {
  tenantId: string;
  runId: string;
  registry: VerticalRegistry;
  now?: Date;
  runPersistence?: MacroGoalRunPersistence;
}) {
  // Scheduling is committed atomically by GoalCycleStore.completeStep after
  // the evaluation result is durably accepted. Keeping it out of the handler
  // prevents every external trigger from spawning its own recurring chain.
  return evaluateMacroGoalRun({
    tenantId: input.tenantId,
    runId: input.runId,
    now: input.now,
    registry: input.registry,
    persistence: input.runPersistence,
  });
}
