import { randomUUID } from "node:crypto";
import mysql, {
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import type {
  DurableExecutionStore,
  DurableLeasedStep,
} from "../../platform/execution/worker";

export const GOAL_CYCLE_TRIGGERS = [
  "goal_activated",
  "scheduled_tick",
  "business_event",
  "action_result",
  "human_result",
  "source_freshness_changed",
  "week_locked",
  "manual_replan",
] as const;
export type GoalCycleTrigger = (typeof GOAL_CYCLE_TRIGGERS)[number];

export type ClaimedGoalCycle = DurableLeasedStep & {
  tenantId: string;
  goalRunId: string;
  triggerType: GoalCycleTrigger;
  triggerSourceReference: string | null;
  maxAttempts: number;
  deadlineAt: Date | null;
};

type CycleRow = RowDataPacket & {
  id: string;
  tenantId: string;
  goalRunId: string;
  triggerType: GoalCycleTrigger;
  triggerSourceReference: string | null;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  deadlineAt: Date | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
};

export type GoalCycleStoreOptions = {
  perTenantConcurrency?: number;
};

/** Live scheduled ticks are the ones that will run again. */
const LIVE_TICK_STATUSES = ["queued", "retry_scheduled", "leased", "running"] as const;

/**
 * Whether another live scheduled tick carries this run's chain. #616's
 * duplicate-chain collapse: an occurrence that finds one hands the chain to it
 * instead of queueing its own successor. The tie-break used to be "lowest id
 * survives", which only held while ticks kept their ids; every occurrence now
 * has a fresh id, so completions are serialized on the run row instead and the
 * first to finish hands off to the one still live. Exactly one chain survives.
 */
async function hasOtherLiveScheduledTick(
  connection: PoolConnection,
  step: Pick<ClaimedGoalCycle, "id" | "tenantId" | "goalRunId">
): Promise<boolean> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT id FROM goal_cycle_requests
      WHERE tenantId = ? AND goalRunId = ? AND triggerType = 'scheduled_tick'
        AND status IN (${LIVE_TICK_STATUSES.map(() => "?").join(",")})
        AND id <> ?
      LIMIT 1`,
    [step.tenantId, step.goalRunId, ...LIVE_TICK_STATUSES, step.id]
  );
  return rows.length > 0;
}

/** Serializes a run's scheduling writes: completions, the bootstrap and enqueue all take it first. */
async function lockRunRow(connection: PoolConnection, input: { tenantId: string; goalRunId: string }) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT status FROM macro_goal_runs WHERE tenantId = ? AND id = ? LIMIT 1 FOR UPDATE`,
    [input.tenantId, input.goalRunId]
  );
  return rows[0] ? String(rows[0].status) : null;
}

/** A dead occurrence is not followed by a new one sooner than this, so a persistent failure can't hot-loop. */
const DEAD_LETTER_REVIVAL_DELAY_MS = 60 * 60 * 1000;

function dateOf(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

/**
 * Queues the run's next scheduled occurrence. Every occurrence is a new row
 * with a new id, so each one gets its own decision; lease retries of one
 * occurrence keep its id. The key names the occurrence it follows
 * (`scheduled_tick:<runId>:after:<predecessorId>`), so one predecessor can never
 * produce two successors. If a live scheduled tick already exists it carries
 * the chain: it is moved earlier if needed and no row is added. Ended
 * occurrences are never revived; their history stays as it was.
 * Caller holds the transaction and the run row lock.
 */
async function queueNextOccurrenceLocked(
  connection: PoolConnection,
  input: {
    tenantId: string;
    goalRunId: string;
    availableAt: Date;
    predecessorId: string;
    triggerSourceReference: string;
  }
): Promise<string> {
  const [liveRows] = await connection.execute<RowDataPacket[]>(
    `SELECT id, status, availableAt
       FROM goal_cycle_requests
      WHERE tenantId = ? AND goalRunId = ? AND triggerType = 'scheduled_tick'
        AND status IN (${LIVE_TICK_STATUSES.map(() => "?").join(",")})
      ORDER BY availableAt, id
      LIMIT 1`,
    [input.tenantId, input.goalRunId, ...LIVE_TICK_STATUSES]
  );
  const live = liveRows[0];
  if (live) {
    const currentAvailableAt = dateOf(live.availableAt);
    if (
      ["queued", "retry_scheduled"].includes(String(live.status)) &&
      (Number.isNaN(currentAvailableAt.getTime()) || input.availableAt.getTime() < currentAvailableAt.getTime())
    ) {
      await connection.execute(
        `UPDATE goal_cycle_requests SET availableAt = ? WHERE tenantId = ? AND id = ?`,
        [input.availableAt, input.tenantId, String(live.id)]
      );
    }
    return String(live.id);
  }

  const idempotencyKey = `scheduled_tick:${input.goalRunId}:after:${input.predecessorId}`;
  const scheduledId = randomUUID();
  const [insert] = await connection.execute<ResultSetHeader>(
    `INSERT IGNORE INTO goal_cycle_requests
       (id, tenantId, goalRunId, triggerType, triggerSourceReference,
        idempotencyKey, status, availableAt, maxAttempts)
     VALUES (?, ?, ?, 'scheduled_tick', ?, ?, 'queued', ?, 5)`,
    [
      scheduledId,
      input.tenantId,
      input.goalRunId,
      input.triggerSourceReference,
      idempotencyKey,
      input.availableAt,
    ]
  );
  if (insert.affectedRows !== 1) {
    const [existing] = await connection.execute<RowDataPacket[]>(
      `SELECT id, goalRunId FROM goal_cycle_requests WHERE tenantId = ? AND idempotencyKey = ? LIMIT 1`,
      [input.tenantId, idempotencyKey]
    );
    if (!existing[0] || String(existing[0].goalRunId) !== input.goalRunId) {
      throw new Error("Scheduled goal cycle key is bound to a different run");
    }
    return String(existing[0].id);
  }
  await insertHistory(connection, {
    tenantId: input.tenantId,
    goalRunId: input.goalRunId,
    requestId: scheduledId,
    eventType: "cycle.queued",
    toStatus: "queued",
    details: {
      triggerType: "scheduled_tick",
      triggerSourceReference: input.triggerSourceReference,
      predecessorId: input.predecessorId,
      availableAt: input.availableAt.toISOString(),
    },
  });
  return scheduledId;
}

async function insertHistory(
  connection: PoolConnection,
  input: {
    tenantId: string;
    goalRunId: string;
    requestId: string;
    eventType: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    leaseOwner?: string | null;
    attemptNumber?: number | null;
    details?: unknown;
    error?: string | null;
  }
) {
  await connection.execute(
    `INSERT INTO goal_cycle_history
       (tenantId, goalRunId, requestId, eventType, fromStatus, toStatus,
        leaseOwner, attemptNumber, detailsJson, errorText)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.tenantId,
      input.goalRunId,
      input.requestId,
      input.eventType,
      input.fromStatus ?? null,
      input.toStatus ?? null,
      input.leaseOwner ?? null,
      input.attemptNumber ?? null,
      input.details === undefined ? null : JSON.stringify(input.details),
      input.error ?? null,
    ]
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nextEvaluationAtFromResult(value: unknown): Date | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as { nextEvaluationAt?: unknown }).nextEvaluationAt;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export class GoalCycleStore
  implements DurableExecutionStore<ClaimedGoalCycle>
{
  private readonly perTenantConcurrency: number;

  constructor(
    private readonly pool: Pool,
    options: GoalCycleStoreOptions = {}
  ) {
    this.perTenantConcurrency = Math.max(
      1,
      Math.floor(options.perTenantConcurrency ?? 2)
    );
  }

  async enqueue(input: {
    tenantId: string;
    goalRunId: string;
    triggerType: GoalCycleTrigger;
    triggerSourceReference?: string | null;
    idempotencyKey: string;
    availableAt?: Date;
    deadlineAt?: Date | null;
    maxAttempts?: number;
  }): Promise<{ id: string; created: boolean }> {
    if (!input.tenantId.trim()) throw new Error("tenantId is required");
    if (!input.goalRunId.trim()) throw new Error("goalRunId is required");
    if (!input.idempotencyKey.trim()) throw new Error("idempotencyKey is required");
    const connection = await this.pool.getConnection();
    const requestId = randomUUID();
    try {
      await connection.beginTransaction();
      const [runRows] = await connection.execute<RowDataPacket[]>(
        `SELECT id FROM macro_goal_runs
          WHERE tenantId = ? AND id = ? LIMIT 1 FOR UPDATE`,
        [input.tenantId, input.goalRunId]
      );
      if (!runRows[0]) throw new Error("Macro goal run not found");

      await connection.execute(
        `INSERT IGNORE INTO goal_cycle_tenant_state (tenantId) VALUES (?)`,
        [input.tenantId]
      );
      const [insert] = await connection.execute<ResultSetHeader>(
        `INSERT IGNORE INTO goal_cycle_requests
           (id, tenantId, goalRunId, triggerType, triggerSourceReference,
            idempotencyKey, status, availableAt, deadlineAt, maxAttempts)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
        [
          requestId,
          input.tenantId,
          input.goalRunId,
          input.triggerType,
          input.triggerSourceReference ?? null,
          input.idempotencyKey,
          input.availableAt ?? new Date(),
          input.deadlineAt ?? null,
          input.maxAttempts ?? 5,
        ]
      );
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT id, goalRunId, triggerType, triggerSourceReference
           FROM goal_cycle_requests
          WHERE tenantId = ? AND idempotencyKey = ? LIMIT 1`,
        [input.tenantId, input.idempotencyKey]
      );
      const existing = rows[0];
      const id = String(existing?.id ?? "");
      if (!id) throw new Error("Unable to resolve durable goal cycle request");
      if (
        insert.affectedRows !== 1 &&
        (
          String(existing?.goalRunId ?? "") !== input.goalRunId ||
          String(existing?.triggerType ?? "") !== input.triggerType ||
          (existing?.triggerSourceReference ?? null) !==
            (input.triggerSourceReference ?? null)
        )
      ) {
        throw new Error("Goal cycle idempotency key is bound to different work");
      }
      if (insert.affectedRows === 1) {
        await insertHistory(connection, {
          tenantId: input.tenantId,
          goalRunId: input.goalRunId,
          requestId: id,
          eventType: "cycle.queued",
          toStatus: "queued",
          details: {
            triggerType: input.triggerType,
            triggerSourceReference: input.triggerSourceReference ?? null,
          },
        });
      }
      await connection.commit();
      return { id, created: insert.affectedRows === 1 };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async claimNextStep(input: {
    leaseOwner: string;
    leaseMs: number;
  }): Promise<ClaimedGoalCycle | null> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      // Fairness is persisted, not process-local: choose the least-recently
      // claimed tenant that has executable work and room under its own cap.
      const [tenantRows] = await connection.query<RowDataPacket[]>(
        `SELECT s.tenantId
           FROM goal_cycle_tenant_state s
          WHERE (
            SELECT COUNT(*)
              FROM goal_cycle_requests active_cycle
             WHERE active_cycle.tenantId = s.tenantId
               AND active_cycle.status IN ('leased','running')
               AND active_cycle.leaseExpiresAt > CURRENT_TIMESTAMP(3)
          ) < ?
            AND EXISTS (
              SELECT 1
                FROM goal_cycle_requests due_cycle
                JOIN macro_goal_runs due_run
                  ON due_run.tenantId = due_cycle.tenantId
                 AND due_run.id = due_cycle.goalRunId
               WHERE due_cycle.tenantId = s.tenantId
                 AND due_run.status = 'active'
                 AND (
                      (due_cycle.status IN ('queued','retry_scheduled')
                       AND due_cycle.availableAt <= CURRENT_TIMESTAMP(3))
                   OR (due_cycle.status IN ('leased','running')
                       AND due_cycle.leaseExpiresAt <= CURRENT_TIMESTAMP(3)
                       AND due_cycle.attemptCount < due_cycle.maxAttempts)
                 )
                 AND (due_cycle.deadlineAt IS NULL OR due_cycle.deadlineAt > CURRENT_TIMESTAMP(3))
                 AND NOT EXISTS (
                   SELECT 1
                     FROM goal_cycle_requests same_run
                    WHERE same_run.tenantId = due_cycle.tenantId
                      AND same_run.goalRunId = due_cycle.goalRunId
                      AND same_run.id <> due_cycle.id
                      AND same_run.status IN ('leased','running')
                      AND same_run.leaseExpiresAt > CURRENT_TIMESTAMP(3)
                 )
            )
          ORDER BY
            CASE WHEN s.lastClaimedAt IS NULL THEN 0 ELSE 1 END,
            s.lastClaimedAt,
            s.tenantId
          LIMIT 1
          FOR UPDATE SKIP LOCKED`,
        [this.perTenantConcurrency]
      );
      const tenantId = String(tenantRows[0]?.tenantId ?? "");
      if (!tenantId) {
        await connection.commit();
        return null;
      }

      const [rows] = await connection.query<CycleRow[]>(
        `SELECT c.id, c.tenantId, c.goalRunId, c.triggerType,
                c.triggerSourceReference, c.status, c.attemptCount,
                c.maxAttempts, c.deadlineAt, c.leaseOwner, c.leaseExpiresAt
           FROM goal_cycle_requests c
           JOIN macro_goal_runs r
             ON r.tenantId = c.tenantId
            AND r.id = c.goalRunId
          WHERE c.tenantId = ?
            AND r.status = 'active'
            AND (
                 (c.status IN ('queued','retry_scheduled')
                  AND c.availableAt <= CURRENT_TIMESTAMP(3))
              OR (c.status IN ('leased','running')
                  AND c.leaseExpiresAt <= CURRENT_TIMESTAMP(3)
                  AND c.attemptCount < c.maxAttempts)
            )
            AND (c.deadlineAt IS NULL OR c.deadlineAt > CURRENT_TIMESTAMP(3))
            AND NOT EXISTS (
              SELECT 1
                FROM goal_cycle_requests same_run
               WHERE same_run.tenantId = c.tenantId
                 AND same_run.goalRunId = c.goalRunId
                 AND same_run.id <> c.id
                 AND same_run.status IN ('leased','running')
                 AND same_run.leaseExpiresAt > CURRENT_TIMESTAMP(3)
            )
          ORDER BY c.availableAt, c.createdAt, c.id
          LIMIT 1
          FOR UPDATE SKIP LOCKED`,
        [tenantId]
      );
      const row = rows[0];
      if (!row) {
        await connection.commit();
        return null;
      }

      const attempt = Number(row.attemptCount) + 1;
      const [update] = await connection.execute<ResultSetHeader>(
        `UPDATE goal_cycle_requests
            SET status = 'leased',
                leaseOwner = ?,
                leaseExpiresAt = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MICROSECOND),
                heartbeatAt = CURRENT_TIMESTAMP(3),
                attemptCount = ?,
                lastError = NULL
          WHERE tenantId = ? AND id = ?`,
        [
          input.leaseOwner,
          input.leaseMs * 1000,
          attempt,
          row.tenantId,
          row.id,
        ]
      );
      if (update.affectedRows !== 1) {
        throw new Error(`Failed to lease goal cycle request ${row.id}`);
      }
      await connection.execute(
        `UPDATE goal_cycle_tenant_state
            SET lastClaimedAt = CURRENT_TIMESTAMP(3)
          WHERE tenantId = ?`,
        [row.tenantId]
      );
      await insertHistory(connection, {
        tenantId: row.tenantId,
        goalRunId: row.goalRunId,
        requestId: row.id,
        eventType: "cycle.leased",
        fromStatus: row.status,
        toStatus: "leased",
        leaseOwner: input.leaseOwner,
        attemptNumber: attempt,
      });
      await connection.commit();

      return {
        id: String(row.id),
        tenantId: row.tenantId,
        goalRunId: row.goalRunId,
        triggerType: row.triggerType,
        triggerSourceReference: row.triggerSourceReference,
        attemptCount: attempt,
        maxAttempts: Number(row.maxAttempts),
        deadlineAt: row.deadlineAt,
        leaseOwner: input.leaseOwner,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async markRunning(step: ClaimedGoalCycle): Promise<boolean> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE goal_cycle_requests
          SET status = 'running'
        WHERE tenantId = ? AND id = ?
          AND status = 'leased'
          AND leaseOwner = ?
          AND leaseExpiresAt > CURRENT_TIMESTAMP(3)`,
      [step.tenantId, step.id, step.leaseOwner]
    );
    return result.affectedRows === 1;
  }

  async heartbeat(step: ClaimedGoalCycle, leaseMs: number): Promise<boolean> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE goal_cycle_requests
          SET heartbeatAt = CURRENT_TIMESTAMP(3),
              leaseExpiresAt = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MICROSECOND)
        WHERE tenantId = ? AND id = ?
          AND status IN ('leased','running')
          AND leaseOwner = ?`,
      [leaseMs * 1000, step.tenantId, step.id, step.leaseOwner]
    );
    return result.affectedRows === 1;
  }

  async completeStep(
    step: ClaimedGoalCycle,
    resultValue: unknown
  ): Promise<boolean> {
    const connection = await this.pool.getConnection();
    const serialized =
      resultValue === undefined ? null : JSON.stringify(resultValue);
    const nextEvaluationAt = nextEvaluationAtFromResult(resultValue);
    try {
      await connection.beginTransaction();
      // Completion, the successor write and the bootstrap's live check all take
      // the run row first, so two finishing occurrences can't both hand off (or
      // both continue) the chain.
      await lockRunRow(connection, step);

      // The occurrence always finishes; it is never re-queued under its own id.
      // That id is the decision identity, so re-queueing it froze decisions.
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE goal_cycle_requests
            SET status = 'completed',
                resultJson = ?,
                completedAt = CURRENT_TIMESTAMP(3),
                leaseOwner = NULL,
                leaseExpiresAt = NULL,
                heartbeatAt = NULL
          WHERE tenantId = ? AND id = ?
            AND status IN ('leased','running')
            AND leaseOwner = ?`,
        [
          serialized,
          step.tenantId,
          step.id,
          step.leaseOwner,
        ]
      );
      if (result.affectedRows !== 1) {
        await connection.rollback();
        return false;
      }

      // Production once carried six live scheduled ticks for one run. A tick that
      // finishes while another live tick exists hands the chain to it.
      const supersededTick =
        Boolean(nextEvaluationAt) &&
        step.triggerType === "scheduled_tick" &&
        (await hasOtherLiveScheduledTick(connection, step));
      await insertHistory(connection, {
        tenantId: step.tenantId,
        goalRunId: step.goalRunId,
        requestId: step.id,
        eventType: "cycle.completed",
        fromStatus: "running",
        toStatus: "completed",
        leaseOwner: step.leaseOwner,
        attemptNumber: step.attemptCount,
        ...(supersededTick ? { details: { supersededBy: "live_scheduled_tick" } } : {}),
      });

      if (nextEvaluationAt && !supersededTick) {
        await queueNextOccurrenceLocked(connection, {
          tenantId: step.tenantId,
          goalRunId: step.goalRunId,
          availableAt: nextEvaluationAt,
          predecessorId: step.id,
          triggerSourceReference: `goal_cycle_requests:${step.id}:scheduled_successor`,
        });
      }

      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * The bootstrap's only scheduling job: make sure an active run has a live
   * cycle. If it has none, it queues the run's next scheduled occurrence, a new
   * row following the run's last scheduled tick. Repeated sweeps resolve to the
   * same key, so they add no rows, and an ended occurrence is never revived
   * (its id is its decision identity). After a dead letter the next occurrence
   * waits an hour from the failure. It never evaluates, prepares or decides;
   * the leased worker does that.
   */
  async ensureLiveScheduledTick(input: {
    tenantId: string;
    goalRunId: string;
    now?: Date;
  }): Promise<{ id: string | null; queued: boolean }> {
    const now = input.now ?? new Date();
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      // The run row lock serializes concurrent sweeps and the worker's successor write.
      if ((await lockRunRow(connection, input)) !== "active") {
        await connection.commit();
        return { id: null, queued: false };
      }
      const [live] = await connection.execute<RowDataPacket[]>(
        `SELECT id FROM goal_cycle_requests
          WHERE tenantId = ? AND goalRunId = ?
            AND status IN (${LIVE_TICK_STATUSES.map(() => "?").join(",")})
          ORDER BY id
          LIMIT 1`,
        [input.tenantId, input.goalRunId, ...LIVE_TICK_STATUSES]
      );
      if (live[0]) {
        await connection.commit();
        return { id: String(live[0].id), queued: false };
      }
      // claimNextStep only considers tenants with a fairness row.
      await connection.execute(
        `INSERT IGNORE INTO goal_cycle_tenant_state (tenantId) VALUES (?)`,
        [input.tenantId]
      );
      const [lastRows] = await connection.execute<RowDataPacket[]>(
        `SELECT id, status, updatedAt FROM goal_cycle_requests
          WHERE tenantId = ? AND goalRunId = ? AND triggerType = 'scheduled_tick'
          ORDER BY createdAt DESC, id DESC
          LIMIT 1`,
        [input.tenantId, input.goalRunId]
      );
      const last = lastRows[0];
      const diedAt = last && String(last.status) === "dead_letter" ? dateOf(last.updatedAt) : null;
      const availableAt =
        diedAt && !Number.isNaN(diedAt.getTime()) && diedAt.getTime() + DEAD_LETTER_REVIVAL_DELAY_MS > now.getTime()
          ? new Date(diedAt.getTime() + DEAD_LETTER_REVIVAL_DELAY_MS)
          : now;
      const id = await queueNextOccurrenceLocked(connection, {
        tenantId: input.tenantId,
        goalRunId: input.goalRunId,
        availableAt,
        predecessorId: last ? String(last.id) : "first",
        triggerSourceReference: "autonomous_supervisor:heartbeat",
      });
      await connection.commit();
      return { id, queued: true };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async failStep(
    step: ClaimedGoalCycle,
    error: unknown,
    retryDelayMs: number
  ): Promise<"retry_scheduled" | "dead_letter" | "lease_lost"> {
    const connection = await this.pool.getConnection();
    const errorText = messageOf(error);
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<CycleRow[]>(
        `SELECT id, tenantId, goalRunId, triggerType, triggerSourceReference,
                status, attemptCount, maxAttempts, deadlineAt, leaseOwner, leaseExpiresAt
           FROM goal_cycle_requests
          WHERE tenantId = ? AND id = ?
          FOR UPDATE`,
        [step.tenantId, step.id]
      );
      const row = rows[0];
      if (
        !row ||
        row.leaseOwner !== step.leaseOwner ||
        !["leased", "running"].includes(row.status)
      ) {
        await connection.rollback();
        return "lease_lost";
      }
      const deadlinePassed =
        row.deadlineAt != null && row.deadlineAt.getTime() <= Date.now();
      const exhausted = Number(row.attemptCount) >= Number(row.maxAttempts);
      if (deadlinePassed || exhausted) {
        await this.deadLetterLocked(connection, row, {
          reason: deadlinePassed ? "deadline_exceeded" : "attempts_exhausted",
          errorText,
        });
        await connection.commit();
        return "dead_letter";
      }

      await connection.execute(
        `UPDATE goal_cycle_requests
            SET status = 'retry_scheduled',
                lastError = ?,
                availableAt = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MICROSECOND),
                leaseOwner = NULL,
                leaseExpiresAt = NULL,
                heartbeatAt = NULL
          WHERE tenantId = ? AND id = ?`,
        [errorText, retryDelayMs * 1000, row.tenantId, row.id]
      );
      await insertHistory(connection, {
        tenantId: row.tenantId,
        goalRunId: row.goalRunId,
        requestId: row.id,
        eventType: "cycle.retry_scheduled",
        fromStatus: row.status,
        toStatus: "retry_scheduled",
        leaseOwner: step.leaseOwner,
        attemptNumber: Number(row.attemptCount),
        error: errorText,
      });
      await connection.commit();
      return "retry_scheduled";
    } catch (failure) {
      await connection.rollback();
      throw failure;
    } finally {
      connection.release();
    }
  }

  async deadLetterExpiredSteps(): Promise<number> {
    const connection = await this.pool.getConnection();
    let count = 0;
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<CycleRow[]>(
        `SELECT id, tenantId, goalRunId, triggerType, triggerSourceReference,
                status, attemptCount, maxAttempts, deadlineAt, leaseOwner, leaseExpiresAt
           FROM goal_cycle_requests
          WHERE (
                (status IN ('queued','retry_scheduled')
                 AND deadlineAt IS NOT NULL
                 AND deadlineAt <= CURRENT_TIMESTAMP(3))
             OR (status IN ('leased','running')
                 AND (
                      (deadlineAt IS NOT NULL AND deadlineAt <= CURRENT_TIMESTAMP(3))
                   OR (leaseExpiresAt IS NOT NULL
                       AND leaseExpiresAt <= CURRENT_TIMESTAMP(3)
                       AND attemptCount >= maxAttempts)
                 ))
          )
          FOR UPDATE SKIP LOCKED`
      );

      for (const row of rows) {
        const finalLeaseExpired =
          ["leased", "running"].includes(row.status) &&
          row.leaseExpiresAt != null &&
          row.leaseExpiresAt.getTime() <= Date.now() &&
          Number(row.attemptCount) >= Number(row.maxAttempts);
        await this.deadLetterLocked(connection, row, {
          reason: finalLeaseExpired ? "attempts_exhausted" : "deadline_exceeded",
          errorText: finalLeaseExpired
            ? "lease_expired_after_final_attempt"
            : "deadline_exceeded",
        });
        count += 1;
      }
      await connection.commit();
      return count;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private async deadLetterLocked(
    connection: PoolConnection,
    row: CycleRow,
    input: { reason: "attempts_exhausted" | "deadline_exceeded"; errorText: string }
  ) {
    await connection.execute(
      `UPDATE goal_cycle_requests
          SET status = 'dead_letter',
              lastError = ?,
              leaseOwner = NULL,
              leaseExpiresAt = NULL,
              heartbeatAt = NULL
        WHERE tenantId = ? AND id = ?`,
      [input.errorText, row.tenantId, row.id]
    );
    await connection.execute(
      `INSERT INTO goal_cycle_dead_letters
         (tenantId, goalRunId, requestId, reason, errorText, attemptCount,
          triggerType, triggerSourceReference)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         reason = VALUES(reason),
         errorText = VALUES(errorText),
         attemptCount = VALUES(attemptCount)`,
      [
        row.tenantId,
        row.goalRunId,
        row.id,
        input.reason,
        input.errorText,
        row.attemptCount,
        row.triggerType,
        row.triggerSourceReference,
      ]
    );
    await insertHistory(connection, {
      tenantId: row.tenantId,
      goalRunId: row.goalRunId,
      requestId: row.id,
      eventType: "cycle.dead_lettered",
      fromStatus: row.status,
      toStatus: "dead_letter",
      leaseOwner: row.leaseOwner,
      attemptNumber: Number(row.attemptCount),
      error: input.errorText,
    });
  }
}

let defaultPool: Pool | null = null;

export function getDefaultGoalCyclePool(): Pool {
  if (defaultPool) return defaultPool;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for durable goal cycles");
  defaultPool = mysql.createPool({
    uri: databaseUrl,
    connectionLimit: 8,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
  return defaultPool;
}

export function createDefaultGoalCycleStore(
  options?: GoalCycleStoreOptions
): GoalCycleStore {
  return new GoalCycleStore(getDefaultGoalCyclePool(), options);
}
