/**
 * One goal-cycle occurrence, run by GoalCycleWorker under its lease.
 *
 * Order: policy first. Only when evaluatePersistentActionPolicy allows the
 * INTERNAL_REVERSIBLE prepare action does the occurrence evaluate the run,
 * prepare a strategic proposal and decide. A denied policy records a `wait`
 * decision with the reason and prepares nothing. The receipt is recorded on
 * every decision as sourceCoverage.actionPolicy.
 *
 * Both worker processes (the web server's in-process workers and the separate
 * procurement worker) use this one handler, so every occurrence is gated the
 * same way whichever process holds the lease.
 */
import { and, eq } from "drizzle-orm";
import { macroGoalRuns } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { prepareStrategicProposal } from "../../strategy/strategicPreparation";
import type { VerticalRegistry } from "../../strategy/verticalTemplates/registry";
import { evaluatePersistentActionPolicy } from "./actionPolicy";
import { decideGoalCycle, type DecideGoalCycleResult } from "./decisionEngine";
import { evaluateMacroGoalRunAndScheduleNext } from "./goalCycleService";
import {
  GOAL_CYCLE_PREPARE_ACTION,
  GOAL_CYCLE_PREPARE_RISK_CLASS,
  goalCyclePolicyAllows,
  goalCyclePolicyReceipt,
  type GoalCyclePolicyReceipt,
} from "./goalCyclePolicy";
import { resolveCanonicalOperatorIdentity } from "./identity";
import type { OperatorAppointmentStore } from "./operatorAppointmentStore";
import { resolveOperatorTimeZone } from "./operatorAppointmentPolicy";
import { scheduleAuthorizedStrategicCall } from "./strategicCallAuthorization";

/** A denied occurrence keeps the run's hourly heartbeat so a restored grant is picked up. */
const DENIED_RECHECK_MS = 60 * 60 * 1000;

export type GoalCycleOccurrenceInput = { tenantId: string; runId: string; cycleId: string };

type RunHeader = {
  id: string;
  status: string;
  canonicalOperatorId: string;
  operatorUserId: string;
};

export type GoalCycleOccurrenceDeps = {
  loadRun: (input: { tenantId: string; runId: string }) => Promise<RunHeader | null>;
  evaluatePolicy: typeof evaluatePersistentActionPolicy;
  evaluateRun: (input: { tenantId: string; runId: string }) => Promise<{
    run: { id: string; status: string; operatorUserId: string; nextEvaluationAt: Date | null };
    completed: boolean;
    observation: unknown;
  }>;
  /** Prepares the operator's strategic proposal. Failures propagate so the step retries. */
  prepare: (input: { tenantId: string; operatorUserId: string }) => Promise<void>;
  decide: (input: GoalCycleOccurrenceInput & { actionPolicy: GoalCyclePolicyReceipt }) => Promise<DecideGoalCycleResult>;
  now?: () => Date;
};

export type GoalCycleOccurrenceResult = {
  runId: string;
  status: string;
  completed: boolean;
  observation: unknown;
  actionPolicy: GoalCyclePolicyReceipt;
  prepared: boolean;
  decisionId: string;
  decisionCreated: boolean;
  objectiveId: string | null;
  selectionKind: string;
  selectedRef: string | null;
  selectedReasonCode: string;
  nextEvaluationAt: string | null;
};

export async function runGoalCycleOccurrence(
  input: GoalCycleOccurrenceInput,
  deps: GoalCycleOccurrenceDeps
): Promise<GoalCycleOccurrenceResult> {
  const now = deps.now?.() ?? new Date();
  const run = await deps.loadRun({ tenantId: input.tenantId, runId: input.runId });
  if (!run) throw new Error("Macro goal run not found");

  const actionPolicy = goalCyclePolicyReceipt(
    await deps.evaluatePolicy({
      tenantId: input.tenantId,
      canonicalOperatorId: run.canonicalOperatorId,
      operatorUserId: run.operatorUserId,
      exactAction: GOAL_CYCLE_PREPARE_ACTION,
      riskClass: GOAL_CYCLE_PREPARE_RISK_CLASS,
      now,
    })
  );

  if (!goalCyclePolicyAllows(actionPolicy)) {
    const decision = await deps.decide({ ...input, actionPolicy });
    return {
      runId: run.id,
      status: run.status,
      completed: false,
      observation: null,
      actionPolicy,
      prepared: false,
      decisionId: decision.decision.id,
      decisionCreated: decision.created,
      objectiveId: null,
      selectionKind: decision.decision.selectionKind,
      selectedRef: decision.decision.selectedRef,
      selectedReasonCode: decision.decision.selectedReasonCode,
      nextEvaluationAt:
        run.status === "active" ? new Date(now.getTime() + DENIED_RECHECK_MS).toISOString() : null,
    };
  }

  const evaluation = await deps.evaluateRun({ tenantId: input.tenantId, runId: input.runId });
  let prepared = false;
  if (evaluation.run.status === "active") {
    await deps.prepare({ tenantId: input.tenantId, operatorUserId: evaluation.run.operatorUserId });
    prepared = true;
  }
  const decision = await deps.decide({ ...input, actionPolicy });
  return {
    runId: evaluation.run.id,
    status: evaluation.run.status,
    completed: evaluation.completed,
    observation: evaluation.observation,
    actionPolicy,
    prepared,
    decisionId: decision.decision.id,
    decisionCreated: decision.created,
    objectiveId: decision.objective?.id ?? null,
    selectionKind: decision.decision.selectionKind,
    selectedRef: decision.decision.selectedRef,
    selectedReasonCode: decision.decision.selectedReasonCode,
    nextEvaluationAt: evaluation.run.nextEvaluationAt?.toISOString() ?? null,
  };
}

async function loadRunHeader(input: { tenantId: string; runId: string }): Promise<RunHeader | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db
    .select({
      id: macroGoalRuns.id,
      status: macroGoalRuns.status,
      canonicalOperatorId: macroGoalRuns.canonicalOperatorId,
      operatorUserId: macroGoalRuns.operatorUserId,
    })
    .from(macroGoalRuns)
    .where(and(eq(macroGoalRuns.tenantId, input.tenantId), eq(macroGoalRuns.id, input.runId)))
    .limit(1);
  return row ?? null;
}

/** Production wiring shared by both worker processes. */
export function defaultGoalCycleOccurrenceDeps(input: {
  registry: VerticalRegistry;
  appointmentStore: OperatorAppointmentStore;
}): GoalCycleOccurrenceDeps {
  return {
    loadRun: loadRunHeader,
    evaluatePolicy: evaluatePersistentActionPolicy,
    evaluateRun: ({ tenantId, runId }) =>
      evaluateMacroGoalRunAndScheduleNext({ tenantId, runId, registry: input.registry }),
    prepare: async ({ tenantId, operatorUserId }) => {
      const resolved = await resolveCanonicalOperatorIdentity({
        tenantId,
        source: { type: "open_id", value: operatorUserId },
        subsystem: "autonomous_strategy_preparation",
      });
      const timeZone = await resolveOperatorTimeZone(tenantId);
      if (!resolved.ok || !timeZone) throw new Error("Autonomous strategy identity/timezone unavailable");
      const proposal = await prepareStrategicProposal({ identity: resolved.identity, timeZone });
      await scheduleAuthorizedStrategicCall({
        identity: resolved.identity,
        timeZone,
        proposalId: proposal.id,
        store: input.appointmentStore,
      }).catch(error => {
        console.warn(
          "[AutonomousWorkers] Prepared proposal remains available; call scheduling unavailable",
          error instanceof Error ? error.message : String(error)
        );
      });
    },
    decide: ({ tenantId, runId, cycleId, actionPolicy }) =>
      decideGoalCycle({ tenantId, runId, cycleId, actionPolicy, registry: input.registry }),
  };
}
