import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export type ClaimedWorkflowStep = {
  id: string;
  workflowId: string;
  stepKey: string;
  stepType: string;
  payload: unknown;
  attemptCount: number;
  maxAttempts: number;
  deadlineAt: Date | null;
  leaseOwner: string;
};

type StepRow = RowDataPacket & {
  id: string;
  workflow_id: string;
  step_key: string;
  step_type: string;
  payload_json: string | object | null;
  attempt_count: number;
  max_attempts: number;
  deadline_at: Date | null;
  status: string;
};

function parseJson(value: string | object | null): unknown {
  if (value === null || typeof value === "object") return value;
  return JSON.parse(value);
}

function jsonParam(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value ?? null);
}

async function insertHistory(
  connection: PoolConnection,
  input: {
    workflowId: string;
    stepId?: string | null;
    eventType: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    leaseOwner?: string | null;
    attemptNumber?: number | null;
    details?: unknown;
    error?: string | null;
  },
) {
  await connection.execute(
    `INSERT INTO procurement_execution_history
       (workflow_id, step_id, event_type, from_status, to_status, lease_owner,
        attempt_number, details_json, error_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.workflowId,
      input.stepId ?? null,
      input.eventType,
      input.fromStatus ?? null,
      input.toStatus ?? null,
      input.leaseOwner ?? null,
      input.attemptNumber ?? null,
      input.details === undefined ? null : JSON.stringify(input.details),
      input.error ?? null,
    ],
  );
}

export class ProcurementWorkflowStore {
  constructor(private readonly pool: Pool) {}

  async createWorkflowWithStep(input: {
    workflowKey: string;
    workflowType: string;
    stepKey: string;
    stepType: string;
    idempotencyKey: string;
    payload?: unknown;
    maxAttempts?: number;
    availableAt?: Date;
    deadlineAt?: Date | null;
  }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute<ResultSetHeader>(
        `INSERT IGNORE INTO procurement_workflows
           (workflow_key, workflow_type, status, input_json, deadline_at, next_run_at)
         VALUES (?, ?, 'pending', ?, ?, ?)`,
        [
          input.workflowKey,
          input.workflowType,
          input.payload === undefined ? null : JSON.stringify(input.payload),
          input.deadlineAt ?? null,
          input.availableAt ?? new Date(),
        ],
      );
      const [workflowRows] = await connection.execute<RowDataPacket[]>(
        "SELECT id FROM procurement_workflows WHERE workflow_key = ?",
        [input.workflowKey],
      );
      const workflowId = String(workflowRows[0]?.id ?? "");
      if (!workflowId) throw new Error(`Unable to resolve workflow ${input.workflowKey}`);
      const [stepResult] = await connection.execute<ResultSetHeader>(
        `INSERT IGNORE INTO procurement_workflow_steps
           (workflow_id, step_key, step_type, status, payload_json, idempotency_key,
            available_at, deadline_at, max_attempts)
         VALUES (?, ?, ?, 'ready', ?, ?, ?, ?, ?)`,
        [
          workflowId,
          input.stepKey,
          input.stepType,
          input.payload === undefined ? null : JSON.stringify(input.payload),
          input.idempotencyKey,
          input.availableAt ?? new Date(),
          input.deadlineAt ?? null,
          input.maxAttempts ?? 5,
        ],
      );
      const [stepRows] = await connection.execute<RowDataPacket[]>(
        "SELECT id FROM procurement_workflow_steps WHERE workflow_id = ? AND step_key = ?",
        [workflowId, input.stepKey],
      );
      const stepId = String(stepRows[0]?.id ?? "");
      if (!stepId) throw new Error(`Unable to resolve workflow step ${input.stepKey}`);
      if (stepResult.affectedRows === 1) {
        await insertHistory(connection, {
          workflowId,
          stepId,
          eventType: "step.created",
          toStatus: "ready",
        });
      }
      await connection.commit();
      return { workflowId, stepId };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async claimNextStep(input: { leaseOwner: string; leaseMs: number }): Promise<ClaimedWorkflowStep | null> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<StepRow[]>(
        `SELECT id, workflow_id, step_key, step_type, payload_json, status,
                attempt_count, max_attempts, deadline_at
           FROM procurement_workflow_steps
          WHERE (
                  (status IN ('ready','retry_scheduled') AND available_at <= CURRENT_TIMESTAMP(3))
               OR (status IN ('leased','running') AND lease_expires_at <= CURRENT_TIMESTAMP(3))
                )
            AND attempt_count < max_attempts
            AND (deadline_at IS NULL OR deadline_at > CURRENT_TIMESTAMP(3))
          ORDER BY available_at, id
          LIMIT 1
          FOR UPDATE SKIP LOCKED`,
      );
      const row = rows[0];
      if (!row) {
        await connection.commit();
        return null;
      }

      const attempt = Number(row.attempt_count) + 1;
      const [update] = await connection.execute<ResultSetHeader>(
        `UPDATE procurement_workflow_steps
            SET status = 'leased', lease_owner = ?,
                lease_expires_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MICROSECOND),
                heartbeat_at = CURRENT_TIMESTAMP(3), attempt_count = ?, last_error = NULL
          WHERE id = ?`,
        [input.leaseOwner, input.leaseMs * 1000, attempt, row.id],
      );
      if (update.affectedRows !== 1) throw new Error(`Failed to lease workflow step ${row.id}`);
      await connection.execute(
        `UPDATE procurement_workflows
            SET status = 'running', current_step_key = ?, next_run_at = NULL
          WHERE id = ? AND status NOT IN ('completed','failed','cancelled','dead_letter')`,
        [row.step_key, row.workflow_id],
      );
      await insertHistory(connection, {
        workflowId: String(row.workflow_id),
        stepId: String(row.id),
        eventType: "step.leased",
        fromStatus: row.status,
        toStatus: "leased",
        leaseOwner: input.leaseOwner,
        attemptNumber: attempt,
      });
      await connection.commit();
      return {
        id: String(row.id),
        workflowId: String(row.workflow_id),
        stepKey: row.step_key,
        stepType: row.step_type,
        payload: parseJson(row.payload_json),
        attemptCount: attempt,
        maxAttempts: Number(row.max_attempts),
        deadlineAt: row.deadline_at,
        leaseOwner: input.leaseOwner,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async markRunning(step: ClaimedWorkflowStep) {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE procurement_workflow_steps
          SET status = 'running'
        WHERE id = ? AND status = 'leased' AND lease_owner = ? AND lease_expires_at > CURRENT_TIMESTAMP(3)`,
      [step.id, step.leaseOwner],
    );
    return result.affectedRows === 1;
  }

  async heartbeat(step: ClaimedWorkflowStep, leaseMs: number) {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE procurement_workflow_steps
          SET heartbeat_at = CURRENT_TIMESTAMP(3),
              lease_expires_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MICROSECOND)
        WHERE id = ? AND status IN ('leased','running') AND lease_owner = ?`,
      [leaseMs * 1000, step.id, step.leaseOwner],
    );
    return result.affectedRows === 1;
  }

  async completeStep(step: ClaimedWorkflowStep, result: unknown) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [update] = await connection.execute<ResultSetHeader>(
        `UPDATE procurement_workflow_steps
            SET status = 'completed', result_json = ?, completed_at = CURRENT_TIMESTAMP(3),
                lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL
          WHERE id = ? AND status IN ('leased','running') AND lease_owner = ?`,
        [result === undefined ? null : JSON.stringify(result), step.id, step.leaseOwner],
      );
      if (update.affectedRows !== 1) {
        await connection.rollback();
        return false;
      }
      const [remaining] = await connection.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS count
           FROM procurement_workflow_steps
          WHERE workflow_id = ? AND status NOT IN ('completed','cancelled')`,
        [step.workflowId],
      );
      if (Number(remaining[0]?.count ?? 0) === 0) {
        await connection.execute(
          `UPDATE procurement_workflows
              SET status = 'completed', output_json = ?, completed_at = CURRENT_TIMESTAMP(3),
                  current_step_key = NULL
            WHERE id = ?`,
          [result === undefined ? null : JSON.stringify(result), step.workflowId],
        );
      }
      await insertHistory(connection, {
        workflowId: step.workflowId,
        stepId: step.id,
        eventType: "step.completed",
        fromStatus: "running",
        toStatus: "completed",
        leaseOwner: step.leaseOwner,
        attemptNumber: step.attemptCount,
      });
      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async failStep(step: ClaimedWorkflowStep, error: unknown, retryDelayMs: number) {
    const connection = await this.pool.getConnection();
    const message = error instanceof Error ? error.message : String(error);
    try {
      await connection.beginTransaction();
      const [locked] = await connection.execute<RowDataPacket[]>(
        `SELECT status, lease_owner, deadline_at, attempt_count, max_attempts, payload_json
           FROM procurement_workflow_steps WHERE id = ? FOR UPDATE`,
        [step.id],
      );
      const row = locked[0];
      if (!row || row.lease_owner !== step.leaseOwner || !["leased", "running"].includes(row.status)) {
        await connection.rollback();
        return "lease_lost" as const;
      }
      const deadlinePassed = row.deadline_at && new Date(row.deadline_at).getTime() <= Date.now();
      const exhausted = Number(row.attempt_count) >= Number(row.max_attempts);
      if (deadlinePassed || exhausted) {
        await connection.execute(
          `UPDATE procurement_workflow_steps
              SET status = 'dead_letter', last_error = ?, lease_owner = NULL,
                  lease_expires_at = NULL, heartbeat_at = NULL
            WHERE id = ?`,
          [message, step.id],
        );
        await connection.execute(
          `INSERT INTO procurement_dead_letters
             (workflow_id, source_type, source_id, reason, payload_json, error_text, attempt_count)
           VALUES (?, 'workflow_step', ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE reason = VALUES(reason), error_text = VALUES(error_text),
             attempt_count = VALUES(attempt_count)`,
          [
            step.workflowId,
            step.id,
            deadlinePassed ? "deadline_exceeded" : "attempts_exhausted",
            jsonParam(row.payload_json),
            message,
            row.attempt_count,
          ],
        );
        await connection.execute(
          `UPDATE procurement_workflows
              SET status = 'dead_letter', failed_at = CURRENT_TIMESTAMP(3)
            WHERE id = ?`,
          [step.workflowId],
        );
        await insertHistory(connection, {
          workflowId: step.workflowId,
          stepId: step.id,
          eventType: "step.dead_lettered",
          fromStatus: row.status,
          toStatus: "dead_letter",
          leaseOwner: step.leaseOwner,
          attemptNumber: Number(row.attempt_count),
          error: message,
        });
        await connection.commit();
        return "dead_letter" as const;
      }

      await connection.execute(
        `UPDATE procurement_workflow_steps
            SET status = 'retry_scheduled', last_error = ?,
                available_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MICROSECOND),
                lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL
          WHERE id = ?`,
        [message, retryDelayMs * 1000, step.id],
      );
      await connection.execute(
        `UPDATE procurement_workflows SET status = 'pending', next_run_at =
           DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MICROSECOND) WHERE id = ?`,
        [retryDelayMs * 1000, step.workflowId],
      );
      await insertHistory(connection, {
        workflowId: step.workflowId,
        stepId: step.id,
        eventType: "step.retry_scheduled",
        fromStatus: row.status,
        toStatus: "retry_scheduled",
        leaseOwner: step.leaseOwner,
        attemptNumber: Number(row.attempt_count),
        error: message,
      });
      await connection.commit();
      return "retry_scheduled" as const;
    } catch (failure) {
      await connection.rollback();
      throw failure;
    } finally {
      connection.release();
    }
  }

  async deadLetterExpiredSteps() {
    const connection = await this.pool.getConnection();
    let count = 0;
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<Array<RowDataPacket & { id: string; workflow_id: string; payload_json: unknown; attempt_count: number }>>(
        `SELECT id, workflow_id, payload_json, attempt_count
           FROM procurement_workflow_steps
          WHERE status IN ('pending','ready','retry_scheduled')
            AND deadline_at IS NOT NULL AND deadline_at <= CURRENT_TIMESTAMP(3)
          FOR UPDATE SKIP LOCKED`,
      );
      for (const row of rows) {
        await connection.execute(
          `UPDATE procurement_workflow_steps SET status = 'dead_letter', last_error = 'deadline_exceeded'
            WHERE id = ?`,
          [row.id],
        );
        await connection.execute(
          `INSERT INTO procurement_dead_letters
             (workflow_id, source_type, source_id, reason, payload_json, error_text, attempt_count)
           VALUES (?, 'workflow_step', ?, 'deadline_exceeded', ?, 'deadline_exceeded', ?)
           ON DUPLICATE KEY UPDATE reason = VALUES(reason)`,
          [row.workflow_id, row.id, jsonParam(row.payload_json), row.attempt_count],
        );
        await connection.execute(
          `UPDATE procurement_workflows SET status = 'dead_letter', failed_at = CURRENT_TIMESTAMP(3)
            WHERE id = ?`,
          [row.workflow_id],
        );
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
}
