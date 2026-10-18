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
import { and, desc, eq, like, lt, ne, or } from "drizzle-orm";
import {
  commercialMissionEvents,
  goalCycleObjectives,
  goalCycleOutcomes,
  macroGoalRuns,
  operatorMacroGoals,
} from "../../../drizzle/schema";
import { getDb } from "../../db";
import { getDefaultGoalCyclePool, GoalCycleStore } from "./goalCycleStore";
import { GoalCycleWorker } from "./goalCycleWorker";
import { defaultGoalCycleOccurrenceDeps, runGoalCycleOccurrence } from "./goalCycleOccurrence";
import { defaultVerticalRegistry } from "../../strategy/verticalTemplates/defaultRegistry";
import { OperatorAppointmentStore } from "./operatorAppointmentStore";
import { OperatorAppointmentWorker } from "./operatorAppointmentWorker";
import { processPendingOutcomeLearnings } from "./learningStore";
import {
  COMMITMENT_COMPLETION_SOURCE,
  commitmentCompletionHandler,
  enqueueCompletedCommitmentObligations,
} from "./commitmentExecutionBridge";
import { drainObservationBridgeObligations, type ObservationBridgeHandler } from "./observationBridgeStore";
import {
  CLEANCLOUD_PAID_ORDER_SOURCE,
  enqueueUnbridgedPaidOrderObligations,
  paidOrderObservationHandler,
} from "./paidOrderObservationBridge";
import { activateMacroGoalRun } from "./macroGoalRuns";
import { normalizeMacroGoalRow } from "../../planning/macroGoalStore";
import { resolveCanonicalOperatorIdentity } from "./identity";
import { resolveTenantVerticalKey } from "../../strategy/marketContext";
import { ensureSundayPlanningAppointment } from "./operatorAppointmentPolicy";

export type AutonomousWorkerOptions = {
  enabled?: boolean;
  leaseOwnerPrefix?: string;
  goalCyclePollMs?: number;
  appointmentPollMs?: number;
  learningDrainIntervalMs?: number;
  bootstrapIntervalMs?: number;
};

/**
 * Bootstrap sweep, outside the worker lease. It only makes sure each active
 * operator goal has an active run and exactly one live goal cycle. It never
 * prepares, plans or decides: the leased GoalCycleWorker occurrence is the one
 * place that does (runGoalCycleOccurrence), with retry/backoff on failure.
 * Each goal is isolated, so one failing tenant cannot abort the sweep.
 */
export async function ensureAutonomousGoalBootstrap(input: {
  store: Pick<GoalCycleStore, "ensureLiveScheduledTick">;
  appointmentStore: OperatorAppointmentStore;
  registry?: typeof defaultVerticalRegistry;
  now?: Date;
}): Promise<{ checked: number; queued: number; failed: Array<{ tenantId: string; goalId: string; error: string }> }> {
  const outcome = { checked: 0, queued: 0, failed: [] as Array<{ tenantId: string; goalId: string; error: string }> };
  const db = await getDb();
  if (!db) return outcome;
  const registry = input.registry ?? defaultVerticalRegistry;

  // 1. Ensure Sunday planning appointment for the configured owner
  try {
    const appt = await ensureSundayPlanningAppointment({ store: input.appointmentStore });
    if (appt?.created) {
      console.info(`[AutonomousWorkers] Scheduled Sunday weekly planning appointment (${appt.id})`);
    }
  } catch (err) {
    console.warn("[AutonomousWorkers] Sunday planning appointment check deferred:", err);
  }

  // 2. Discover active operator macro goals and ensure an active run with one live cycle
  let activeGoals: Array<typeof operatorMacroGoals.$inferSelect>;
  try {
    activeGoals = await db
      .select()
      .from(operatorMacroGoals)
      .where(eq(operatorMacroGoals.status, "active"));
  } catch (err) {
    console.warn("[AutonomousWorkers] Error listing active goals:", err);
    return outcome;
  }

  for (const goal of activeGoals) {
    if (!goal.tenantId || !goal.operatorUserId) continue;
    outcome.checked += 1;
    try {
      const resolution = await resolveCanonicalOperatorIdentity({
        tenantId: goal.tenantId,
        subsystem: "autonomous_goal_bootstrap",
        source: { type: "open_id", value: goal.operatorUserId },
      });
      if (!resolution.ok) continue;

      // Check if an active macro_goal_run exists
      const [existingRun] = await db
        .select()
        .from(macroGoalRuns)
        .where(
          and(
            eq(macroGoalRuns.tenantId, goal.tenantId),
            eq(macroGoalRuns.status, "active"),
            eq(macroGoalRuns.macroGoalId, goal.id)
          )
        )
        .limit(1);

      let targetRunId = existingRun?.id;

      if (!targetRunId) {
        const verticalKey = await resolveTenantVerticalKey(goal.tenantId);
        // The vertical must measure this goal's metric (and its area scope, if any).
        try { registry.resolveMetric(verticalKey, goal.metricKey); } catch { continue; }
        // Every active goal gets its own run. Several goals can be active at
        // once; activating "the most recent goal" here left the others unpursued.
        const activated = await activateMacroGoalRun({
          tenantId: goal.tenantId,
          identity: resolution.identity,
          verticalKey,
          policyVersion: "v1",
          registry,
          goal: normalizeMacroGoalRow(goal),
        });
        if (activated) {
          targetRunId = activated.id;
          console.info(
            `[AutonomousWorkers] Activated macro goal run ${targetRunId} for tenant ${goal.tenantId} (${goal.metricKey}: ${activated.baselineValue} -> ${activated.targetValue})`
          );
        }
      }

      if (targetRunId) {
        // A running cycle is live too. The store checks every live cycle for the
        // run under the run's row lock, and revives the run's one scheduled tick
        // rather than minting a new row per sweep or per hour.
        const ensured = await input.store.ensureLiveScheduledTick({
          tenantId: goal.tenantId,
          goalRunId: targetRunId,
          now: input.now,
        });
        if (ensured.queued) {
          outcome.queued += 1;
          console.info(
            `[AutonomousWorkers] Queued goal cycle ${ensured.id} for run ${targetRunId}`
          );
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      outcome.failed.push({ tenantId: goal.tenantId, goalId: goal.id, error });
      console.warn("[AutonomousWorkers] Goal bootstrap failed for one goal; continuing", {
        tenantId: goal.tenantId,
        goalId: goal.id,
        error,
      });
    }
  }
  return outcome;
}

export async function sweepUnbridgedParkingLotDebriefs(input: {
  limit?: number;
} = {}): Promise<{
  processedCount: number;
  errors: Array<{ eventId: number; error: string }>;
}> {
  const db = await getDb();
  if (!db) return { processedCount: 0, errors: [] };

  const limit = input.limit ?? 25;
  const recentEvents = await db
    .select({
      id: commercialMissionEvents.id,
      tenantId: commercialMissionEvents.tenantId,
      missionId: commercialMissionEvents.missionId,
      actorId: commercialMissionEvents.actorId,
      metadataJson: commercialMissionEvents.metadataJson,
      createdAt: commercialMissionEvents.createdAt,
    })
    .from(commercialMissionEvents)
    .where(eq(commercialMissionEvents.eventName, "parking_lot_clerk_observation"))
    .orderBy(desc(commercialMissionEvents.id))
    .limit(limit);

  let processedCount = 0;
  const errors: Array<{ eventId: number; error: string }> = [];

  for (const event of recentEvents) {
    const evidenceReference = `commercial_mission_events:${event.id}`;
    const [existingOutcome] = await db
      .select({ id: goalCycleOutcomes.id })
      .from(goalCycleOutcomes)
      .where(
        and(
          eq(goalCycleOutcomes.tenantId, event.tenantId),
          eq(goalCycleOutcomes.evidenceReference, evidenceReference)
        )
      )
      .limit(1);

    if (existingOutcome) {
      continue;
    }

    try {
      const metadata = (event.metadataJson ?? {}) as Record<string, unknown>;
      const debriefText = typeof metadata.text === "string" ? metadata.text : "";
      const { bridgeParkingLotDebrief } = await import("./fieldEventBridge");
      const result = await bridgeParkingLotDebrief({
        tenantId: event.tenantId,
        actorId: event.actorId ?? "clerk",
        missionId: event.missionId,
        evidenceReference,
        debriefText,
        observedAt: event.createdAt,
      });

      if (result.bridged) {
        processedCount++;
      }
    } catch (err) {
      errors.push({
        eventId: event.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { processedCount, errors };
}

export async function sweepUnpropagatedConquestWins(input: {
  tenantId?: string;
  limit?: number;
  batchSize?: number;
} = {}): Promise<{
  processedCount: number;
  errors: Array<{ missionId: number; error: string }>;
}> {
  const db = await getDb();
  if (!db) return { processedCount: 0, errors: [] };

  const targetLimit = input.limit ?? 25;
  const batchSize = input.batchSize ?? 50;

  let processedCount = 0;
  const errors: Array<{ missionId: number; error: string }> = [];
  let cursorId: number | null = null;
  const visitedMissionIds = new Set<number>();

  // Page/cursor through won events until targetLimit unpropagated events are processed
  // or until there are no further won events in the backlog.
  while (processedCount < targetLimit) {
    const conditions = [
      eq(commercialMissionEvents.toStatus, "won"),
      ne(commercialMissionEvents.eventName, "geographic_conquest_propagated"),
    ];
    if (input.tenantId) {
      conditions.push(eq(commercialMissionEvents.tenantId, input.tenantId));
    }
    if (cursorId !== null) {
      conditions.push(lt(commercialMissionEvents.id, cursorId));
    }

    const batch = await db
      .select({
        id: commercialMissionEvents.id,
        tenantId: commercialMissionEvents.tenantId,
        missionId: commercialMissionEvents.missionId,
        actorId: commercialMissionEvents.actorId,
        createdAt: commercialMissionEvents.createdAt,
      })
      .from(commercialMissionEvents)
      .where(and(...conditions))
      .orderBy(desc(commercialMissionEvents.id))
      .limit(batchSize);

    if (batch.length === 0) {
      break;
    }

    const previousCursor: number | null = cursorId;

    for (const event of batch) {
      cursorId = event.id;

      if (visitedMissionIds.has(event.missionId)) {
        continue;
      }
      visitedMissionIds.add(event.missionId);

      const conquestEvidenceRef = `commercial_missions:${event.missionId}:conquest`;

      // A. Check if conquest outcome receipt already exists
      const [existingOutcome] = await db
        .select({ id: goalCycleOutcomes.id })
        .from(goalCycleOutcomes)
        .where(
          and(
            eq(goalCycleOutcomes.tenantId, event.tenantId),
            eq(goalCycleOutcomes.evidenceReference, conquestEvidenceRef)
          )
        )
        .limit(1);

      if (existingOutcome) {
        continue;
      }

      // B. Check if conquest completion receipt exists in commercialMissionEvents
      const [existingReceipt] = await db
        .select({ id: commercialMissionEvents.id })
        .from(commercialMissionEvents)
        .where(
          and(
            eq(commercialMissionEvents.tenantId, event.tenantId),
            eq(commercialMissionEvents.missionId, event.missionId),
            eq(commercialMissionEvents.eventName, "geographic_conquest_propagated")
          )
        )
        .limit(1);

      if (existingReceipt) {
        continue;
      }

      // C. Recover original objectiveId from durable account_won outcome (even after objective completed)
      let recoveredObjectiveId: string | null = null;
      const wonOutcomes = await db
        .select({
          objectiveId: goalCycleOutcomes.objectiveId,
          metadataJson: goalCycleOutcomes.metadataJson,
        })
        .from(goalCycleOutcomes)
        .where(
          and(
            eq(goalCycleOutcomes.tenantId, event.tenantId),
            eq(goalCycleOutcomes.outcomeKind, "account_won")
          )
        )
        .orderBy(desc(goalCycleOutcomes.createdAt))
        .limit(50);

      for (const outcome of wonOutcomes) {
        const meta = outcome.metadataJson as { missionId?: number | string } | null;
        if (meta?.missionId && Number(meta.missionId) === event.missionId) {
          recoveredObjectiveId = outcome.objectiveId;
          break;
        }
      }

      // D. If not found in outcomes, check goalCycleObjectives directly (including completed objectives)
      if (!recoveredObjectiveId) {
        const [matchedObj] = await db
          .select({ id: goalCycleObjectives.id })
          .from(goalCycleObjectives)
          .where(
            and(
              eq(goalCycleObjectives.tenantId, event.tenantId),
              or(
                eq(goalCycleObjectives.selectedRef, String(event.missionId)),
                and(
                  eq(goalCycleObjectives.actionTargetType, "commercial_mission"),
                  eq(goalCycleObjectives.actionTargetId, String(event.missionId))
                )
              )
            )
          )
          .orderBy(desc(goalCycleObjectives.createdAt))
          .limit(1);

        if (matchedObj) {
          recoveredObjectiveId = matchedObj.id;
        }
      }

      try {
        const { propagateGeographicConquest } = await import("./geographicConquestService");
        const result = await propagateGeographicConquest({
          tenantId: event.tenantId,
          missionId: event.missionId,
          actorId: event.actorId,
          objectiveId: recoveredObjectiveId,
        });

        processedCount++;
        if (processedCount >= targetLimit) {
          break;
        }
      } catch (err) {
        errors.push({
          missionId: event.missionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (cursorId === previousCursor) {
      break;
    }
  }

  return { processedCount, errors };
}

/** Completed commitments and paid orders look back this far for a missing obligation. */
const OBSERVATION_RECONCILIATION_DAYS = 30;

/**
 * Reconcile observation bridges. Source events with no obligation (a crash
 * after the commit, a completion path that never bridged) get one; then due
 * obligations are retried, commitment completions before paid orders, so an
 * order whose attempt was just linked is not judged before its attempt.
 * Per-item errors are returned, never swallowed.
 */
export async function sweepObservationBridges(input: { leaseOwner: string; now?: Date; limit?: number }) {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - OBSERVATION_RECONCILIATION_DAYS * 86_400_000);
  const commitments = await enqueueCompletedCommitmentObligations({ since, now });
  const paidOrders = await enqueueUnbridgedPaidOrderObligations({ since, now });
  const passes: Array<Record<string, ObservationBridgeHandler>> = [
    { [COMMITMENT_COMPLETION_SOURCE]: commitmentCompletionHandler },
    { [CLEANCLOUD_PAID_ORDER_SOURCE]: paidOrderObservationHandler },
  ];
  const summary = { discovered: commitments.enqueued + paidOrders.enqueued, attempted: 0, byStatus: {} as Record<string, number>, errors: [] as Array<{ id: string; sourceKind: string; sourceKey: string; error: string }> };
  for (const handlers of passes) {
    const drained = await drainObservationBridgeObligations({ handlers, leaseOwner: input.leaseOwner, limit: input.limit ?? 25, now });
    summary.attempted += drained.attempted;
    for (const [status, count] of Object.entries(drained.byStatus)) summary.byStatus[status] = (summary.byStatus[status] ?? 0) + (count ?? 0);
    summary.errors.push(...drained.errors);
  }
  return summary;
}

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

  const operatorAppointmentStore = new OperatorAppointmentStore(pool);

  // 1. Goal Cycle Worker (Macro Goal Evaluation & Replanning)
  const goalCycleStore = new GoalCycleStore(pool, { perTenantConcurrency: 2 });
  const occurrenceDeps = defaultGoalCycleOccurrenceDeps({
    registry: defaultVerticalRegistry,
    appointmentStore: operatorAppointmentStore,
  });
  const goalCycleWorker = new GoalCycleWorker(
    goalCycleStore,
    {
      leaseOwner: `${leaseOwner}:goal-cycle`,
      leaseMs: 60_000,
      pollMs: options.goalCyclePollMs ?? 5_000,
      concurrency: 2,
      retryBaseMs: 5_000,
    },
    input => runGoalCycleOccurrence(input, occurrenceDeps)
  );

  // 2. Operator Appointment Worker (Sunday Planning & Callbacks)
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

  // 3. Periodic Outcome Learning & Debrief Outbox Sweeper
  const learningDrainIntervalMs = options.learningDrainIntervalMs ?? 30_000;
  let learningSweeperActive = false;
  const learningTimer = setInterval(async () => {
    if (learningSweeperActive) return;
    learningSweeperActive = true;
    try {
      // Step 0: Durable observation bridges (completed commitments → their goal objective)
      const bridges = await sweepObservationBridges({ leaseOwner: `${leaseOwner}:observation-bridge` });
      if (bridges.attempted > 0 || bridges.discovered > 0) {
        console.info(
          `[AutonomousWorkers] Observation bridges: ${bridges.discovered} discovered, ${bridges.attempted} attempted`,
          bridges.byStatus
        );
      }
      for (const error of bridges.errors) {
        console.warn("[AutonomousWorkers] Observation bridge will retry", error);
      }

      // Step A: Sweep unbridged parking-lot debriefs into outcomes
      const debriefResult = await sweepUnbridgedParkingLotDebriefs();
      if (debriefResult.processedCount > 0) {
        console.info(
          `[AutonomousWorkers] Debrief sweeper bridged ${debriefResult.processedCount} pending observations`
        );
      }

      // Step B: Sweep unpropagated conquest wins into corridor missions & obligations
      const conquestResult = await sweepUnpropagatedConquestWins();
      if (conquestResult.processedCount > 0) {
        console.info(
          `[AutonomousWorkers] Conquest sweeper propagated ${conquestResult.processedCount} unpropagated wins`
        );
      }

      // Step C: Reconcile outcomes into learned deltas
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

  // 4. Initial Bootstrap & Periodic Goal/Appointment Sync
  const bootstrapIntervalMs = options.bootstrapIntervalMs ?? 300_000;
  const bootstrapInitialTimer = setTimeout(() => {
    void ensureAutonomousGoalBootstrap({
      store: goalCycleStore,
      appointmentStore: operatorAppointmentStore,
    });
    void sweepUnbridgedParkingLotDebriefs();
    void sweepUnpropagatedConquestWins();
  }, 5_000);

  const bootstrapIntervalTimer = setInterval(() => {
    void ensureAutonomousGoalBootstrap({
      store: goalCycleStore,
      appointmentStore: operatorAppointmentStore,
    });
  }, bootstrapIntervalMs);

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
    clearTimeout(bootstrapInitialTimer);
    clearInterval(bootstrapIntervalTimer);
    clearInterval(learningTimer);
    await Promise.allSettled([
      goalCycleWorker.stop(),
      operatorAppointmentWorker.stop(),
    ]);
    console.info("[AutonomousWorkers] Autonomous workers stopped.");
  };
}
