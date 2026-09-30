/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
/**
 * Autonomous Persistent Operator In-Process Background Worker Engine
 *
 * Runs the self-driving heartbeat of the Persistent Growth Operator within
 * the production server process:
 *
 * 1. GoalCycleWorker: Evaluates macro goal runs and materializes new cycle decisions/objectives.
 * 2. OperatorAppointmentWorker: Executes scheduled operator appointments (Sunday planning, callbacks).
 * 3. LearningOutboxSweeper: Periodically reconciles verified/rejected outcomes to learned deltas.
 *
 * Safety & Resilience:
 * - Distributed lease locks via MySQL (prevents duplicate execution across multiple server instances).
 * - Fails open/graceful on missing DB or transient network disconnects.
 * - Clean teardown on server shutdown.
 */

import crypto from "node:crypto";
import os from "node:os";
import { getDefaultGoalCyclePool, GoalCycleStore } from "./goalCycleStore";
import { GoalCycleWorker } from "./goalCycleWorker";
import { evaluateMacroGoalRunAndScheduleNext } from "./goalCycleService";
import { decideGoalCycle } from "./decisionEngine";
import { defaultVerticalRegistry } from "../strategy/verticalTemplates/defaultRegistry";
import { OperatorAppointmentStore } from "./operatorAppointmentStore";
import { OperatorAppointmentWorker } from "./operatorAppointmentWorker";
import { processPendingOutcomeLearnings } from "./learningStore";

export type AutonomousWorkerOptions = {
  enabled?: boolean;
  leaseOwnerPrefix?: string;
  goalCyclePollMs?: number;
  appointmentPollMs?: number;
  learningDrainIntervalMs?: number;
};

export function startAutonomousPersistentOperatorWorkers(
  options: AutonomousWorkerOptions = {}
): () => Promise<void> {
  const isExplicitlyDisabled =
    options.enabled === false ||
    process.env.AUTONOMOUS_WORKERS_ENABLED === "0" ||
    process.env.AUTONOMOUS_WORKERS_ENABLED === "false";

  if (isExplicitlyDisabled) {
    console.info("[AutonomousWorkers] Autonomous workers explicitly disabled by configuration.");
    return async () => undefined;
  }

  if (!process.env.DATABASE_URL) {
    console.info("[AutonomousWorkers] DATABASE_URL not configured; autonomous workers disabled.");
    return async () => undefined;
  }

  const leaseOwner =
    options.leaseOwnerPrefix ??
    process.env.PROCUREMENT_WORKER_ID ??
    process.env.RAILWAY_REPLICA_ID ??
    `${os.hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;

  console.info(`[AutonomousWorkers] Initializing autonomous workers (leaseOwner: ${leaseOwner})`);

  let pool: ReturnType<typeof getDefaultGoalCyclePool>;
  try {
    pool = getDefaultGoalCyclePool();
  } catch (err) {
    console.warn("[AutonomousWorkers] Failed to initialize goal cycle pool:", err);
    return async () => undefined;
  }

  // 1. Goal Cycle Worker (Macro Goal Evaluation & Replanning)
  const goalCycleStore = new GoalCycleStore(pool, { perTenantConcurrency: 2 });
  const goalCycleWorker = new GoalCycleWorker(
    goalCycleStore,
    {
      leaseOwner: `${leaseOwner}:goal-cycle`,
      leaseMs: 60_000,
      pollMs: options.goalCyclePollMs ?? 5_000,
      concurrency: 2,
      retryBaseMs: 5_000,
    },
    async input => {
      const evaluation = await evaluateMacroGoalRunAndScheduleNext({
        tenantId: input.tenantId,
        runId: input.runId,
        registry: defaultVerticalRegistry,
      });
      const decision = await decideGoalCycle({
        tenantId: input.tenantId,
        runId: input.runId,
        cycleId: input.cycleId,
        registry: defaultVerticalRegistry,
      });
      return {
        runId: evaluation.run.id,
        status: evaluation.run.status,
        completed: evaluation.completed,
        observation: evaluation.observation,
        decisionId: decision.decision.id,
        decisionCreated: decision.created,
        objectiveId: decision.objective?.id ?? null,
        selectionKind: decision.decision.selectionKind,
        selectedRef: decision.decision.selectedRef,
        selectedReasonCode: decision.decision.selectedReasonCode,
        nextEvaluationAt: evaluation.run.nextEvaluationAt?.toISOString() ?? null,
      };
    }
  );

  // 2. Operator Appointment Worker (Sunday Planning & Callbacks)
  const operatorAppointmentStore = new OperatorAppointmentStore(pool);
  const operatorAppointmentWorker = new OperatorAppointmentWorker(
    operatorAppointmentStore,
    {
      leaseOwner: `${leaseOwner}:operator-appointment`,
      leaseMs: 60_000,
      pollMs: options.appointmentPollMs ?? 30_000,
      concurrency: 1,
      retryBaseMs: 30_000,
    }
  );

  // 3. Periodic Outcome Learning Outbox Sweeper
  const learningDrainIntervalMs = options.learningDrainIntervalMs ?? 30_000;
  let learningSweeperActive = false;
  const learningTimer = setInterval(async () => {
    if (learningSweeperActive) return;
    learningSweeperActive = true;
    try {
      const result = await processPendingOutcomeLearnings();
      if (result.processedCount > 0) {
        console.info(
          `[AutonomousWorkers] Learning outbox drained ${result.processedCount} pending outcomes`
        );
      }
    } catch (err) {
      console.warn("[AutonomousWorkers] Error draining learning outbox:", err);
    } finally {
      learningSweeperActive = false;
    }
  }, learningDrainIntervalMs);

  // Start durable poll loops
  try {
    void goalCycleWorker.start();
    void operatorAppointmentWorker.start();
    console.info("[AutonomousWorkers] Persistent Growth Operator heartbeat started successfully.");
  } catch (err) {
    console.error("[AutonomousWorkers] Failed to start durable workers:", err);
  }

  let stopped = false;
  return async () => {
    if (stopped) return;
    stopped = true;
    console.info("[AutonomousWorkers] Stopping autonomous workers...");
    clearInterval(learningTimer);
    await Promise.allSettled([
      goalCycleWorker.stop(),
      operatorAppointmentWorker.stop(),
    ]);
    console.info("[AutonomousWorkers] Autonomous workers stopped.");
  };
}
