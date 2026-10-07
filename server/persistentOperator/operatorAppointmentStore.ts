import { randomUUID } from "node:crypto";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import type {
  DurableExecutionStore,
  DurableLeasedStep,
} from "../durableExecution/worker";

export type OperatorAppointmentKind =
  | "sunday_weekly_planning"
  | "weekly_planning_callback";

export type ClaimedOperatorAppointment = DurableLeasedStep & {
  tenantId: string;
  canonicalOperatorId: string;
  operatorUserId: string;
  appointmentKind: OperatorAppointmentKind;
  weekStart: string;
  scheduledFor: Date;
  timeZone: string;
  source: "standing_weekly_authorization" | "explicit_operator_request";
  sourceReference: string;
  idempotencyKey: string;
  standingAuthorizationId: string | null;
  unprompted: boolean;
  maxAttempts: number;
};

type AppointmentRow = RowDataPacket & {
  id: string;
  tenantId: string;
  canonicalOperatorId: string;
  operatorUserId: string;
  appointmentKind: OperatorAppointmentKind;
  weekStart: string;
  scheduledFor: Date;
  timeZone: string;
  source: "standing_weekly_authorization" | "explicit_operator_request";
  sourceReference: string;
  standingAuthorizationId: string | null;
  unprompted: number | boolean;
  idempotencyKey: string;
  status: string;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  attemptCount: number;
  maxAttempts: number;
  callDispatchStartedAt: Date | null;
  callSid: string | null;
  followupTextSentAt: Date | null;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function claimed(row: AppointmentRow, leaseOwner: string): ClaimedOperatorAppointment {
  return {
    id: row.id,
    tenantId: row.tenantId,
    canonicalOperatorId: row.canonicalOperatorId,
    operatorUserId: row.operatorUserId,
    appointmentKind: row.appointmentKind,
    weekStart: row.weekStart,
    scheduledFor: row.scheduledFor,
    timeZone: row.timeZone,
    source: row.source,
    sourceReference: row.sourceReference,
    idempotencyKey: row.idempotencyKey,
    standingAuthorizationId: row.standingAuthorizationId,
    unprompted: Boolean(row.unprompted),
    attemptCount: Number(row.attemptCount),
    maxAttempts: Number(row.maxAttempts),
    leaseOwner,
  };
}

export class OperatorAppointmentStore
  implements DurableExecutionStore<ClaimedOperatorAppointment>
{
  constructor(private readonly pool: Pool) {}

  async enqueue(input: {
    tenantId: string;
    canonicalOperatorId: string;
    operatorUserId: string;
    appointmentKind: OperatorAppointmentKind;
    weekStart: string;
    scheduledFor: Date;
    timeZone: string;
    source: "standing_weekly_authorization" | "explicit_operator_request";
    sourceReference: string;
    standingAuthorizationId?: string | null;
    unprompted: boolean;
    idempotencyKey: string;
    maxAttempts?: number;
  }): Promise<{ id: string; created: boolean }> {
    if (!input.tenantId.trim()) {
      throw new Error("Operator appointment tenantId is required");
    }
    if (!input.canonicalOperatorId.trim()) {
      throw new Error("Operator appointment canonicalOperatorId is required");
    }
    if (!input.operatorUserId.trim()) {
      throw new Error("Operator appointment operatorUserId is required");
    }
    if (!input.sourceReference.trim()) {
      throw new Error("Operator appointment sourceReference is required");
    }
    if (!input.idempotencyKey.trim()) {
      throw new Error("Operator appointment idempotencyKey is required");
    }

    const connection = await this.pool.getConnection();
    const id = randomUUID();
    try {
      await connection.beginTransaction();
      const [insert] = await connection.execute<ResultSetHeader>(
        `INSERT IGNORE INTO operator_appointments
           (id, tenantId, canonicalOperatorId, operatorUserId, appointmentKind,
            weekStart, scheduledFor, timeZone, source, sourceReference,
            standingAuthorizationId, unprompted, idempotencyKey, status, maxAttempts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)`,
        [
          id,
          input.tenantId,
          input.canonicalOperatorId,
          input.operatorUserId,
          input.appointmentKind,
          input.weekStart,
          input.scheduledFor,
          input.timeZone,
          input.source,
          input.sourceReference,
          input.standingAuthorizationId ?? null,
          input.unprompted,
          input.idempotencyKey,
          input.maxAttempts ?? 3,
        ]
      );
      const [rows] = await connection.execute<AppointmentRow[]>(
        `SELECT *
           FROM operator_appointments
          WHERE tenantId = ? AND idempotencyKey = ?
          LIMIT 1
          FOR UPDATE`,
        [input.tenantId, input.idempotencyKey]
      );
      const row = rows[0];
      if (!row) throw new Error("Unable to resolve durable operator appointment");
      if (
        insert.affectedRows !== 1 &&
        (
          row.canonicalOperatorId !== input.canonicalOperatorId ||
          row.operatorUserId !== input.operatorUserId ||
          row.appointmentKind !== input.appointmentKind ||
          row.weekStart !== input.weekStart ||
          row.sourceReference !== input.sourceReference
        )
      ) {
        throw new Error("Operator appointment idempotency key is bound to different work");
      }
      const sundayExecutionSnapshotChanged =
        row.standingAuthorizationId !== (input.standingAuthorizationId ?? null) ||
        row.timeZone !== input.timeZone;
      if (
        insert.affectedRows !== 1 &&
        row.appointmentKind === "sunday_weekly_planning" &&
        ["scheduled", "retry_scheduled", "leased", "running"].includes(row.status) &&
        row.callDispatchStartedAt == null &&
        (
          ["scheduled", "retry_scheduled"].includes(row.status) ||
          sundayExecutionSnapshotChanged
        )
      ) {
        // The weekly idempotency key intentionally survives authorization
        // rotation. Refresh authority/timezone until external dispatch begins.
        // If another replica already leased the old snapshot, revoke that lease
        // immediately and refund its claim: no real execution occurred, and
        // leaving a stale final-attempt lease alive would let expiry dead-letter
        // the current week's appointment before the stale worker can fail it.
        await connection.execute(
          `UPDATE operator_appointments
              SET scheduledFor = CASE
                    WHEN status = 'scheduled' THEN ?
                    WHEN status IN ('leased','running') THEN CURRENT_TIMESTAMP(3)
                    ELSE scheduledFor
                  END,
                  attemptCount = CASE
                    WHEN status IN ('leased','running')
                      THEN GREATEST(attemptCount - 1, 0)
                    ELSE attemptCount
                  END,
                  leaseOwner = CASE
                    WHEN status IN ('leased','running') THEN NULL
                    ELSE leaseOwner
                  END,
                  leaseExpiresAt = CASE
                    WHEN status IN ('leased','running') THEN NULL
                    ELSE leaseExpiresAt
                  END,
                  heartbeatAt = CASE
                    WHEN status IN ('leased','running') THEN NULL
                    ELSE heartbeatAt
                  END,
                  status = CASE
                    WHEN status IN ('leased','running') THEN 'retry_scheduled'
                    ELSE status
                  END,
                  timeZone = ?,
                  standingAuthorizationId = ?
            WHERE tenantId = ? AND id = ?
              AND appointmentKind = 'sunday_weekly_planning'
              AND status IN ('scheduled','retry_scheduled','leased','running')
              AND callDispatchStartedAt IS NULL`,
          [
            input.scheduledFor,
            input.timeZone,
            input.standingAuthorizationId ?? null,
            input.tenantId,
            row.id,
          ]
        );
      }
      if (
        insert.affectedRows !== 1 &&
        row.status === "cancelled" &&
        row.appointmentKind === "weekly_planning_callback"
      ) {
        await connection.execute(
          `UPDATE operator_appointments
              SET status = 'scheduled',
                  scheduledFor = ?,
                  completedAt = NULL,
                  lastError = NULL
            WHERE tenantId = ? AND id = ? AND status = 'cancelled'`,
          [input.scheduledFor, input.tenantId, row.id]
        );
      }
      await connection.commit();
      return { id: row.id, created: insert.affectedRows === 1 };
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
  }): Promise<ClaimedOperatorAppointment | null> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<AppointmentRow[]>(
        `SELECT *
           FROM operator_appointments
          WHERE (
                (status IN ('scheduled','retry_scheduled')
                 AND scheduledFor <= CURRENT_TIMESTAMP(3))
             OR (status IN ('leased','running')
                 AND leaseExpiresAt IS NOT NULL
                 AND leaseExpiresAt <= CURRENT_TIMESTAMP(3)
                 AND attemptCount < maxAttempts
                 AND callDispatchStartedAt IS NULL)
          )
          ORDER BY scheduledFor, createdAt, id
          LIMIT 1
          FOR UPDATE SKIP LOCKED`
      );
      const row = rows[0];
      if (!row) {
        await connection.commit();
        return null;
      }
      const attemptCount = Number(row.attemptCount) + 1;
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE operator_appointments
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
          attemptCount,
          row.tenantId,
          row.id,
        ]
      );
      if (result.affectedRows !== 1) {
        throw new Error(`Failed to lease operator appointment ${row.id}`);
      }
      await connection.commit();
      return claimed({ ...row, attemptCount }, input.leaseOwner);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async markRunning(step: ClaimedOperatorAppointment): Promise<boolean> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE operator_appointments
          SET status = 'running'
        WHERE tenantId = ? AND id = ?
          AND status = 'leased'
          AND leaseOwner = ?
          AND leaseExpiresAt > CURRENT_TIMESTAMP(3)`,
      [step.tenantId, step.id, step.leaseOwner]
    );
    return result.affectedRows === 1;
  }

  async heartbeat(
    step: ClaimedOperatorAppointment,
    leaseMs: number
  ): Promise<boolean> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE operator_appointments
          SET heartbeatAt = CURRENT_TIMESTAMP(3),
              leaseExpiresAt = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MICROSECOND)
        WHERE tenantId = ? AND id = ?
          AND status IN ('leased','running')
          AND leaseOwner = ?
          AND standingAuthorizationId <=> ?
          AND timeZone = ?`,
      [
        leaseMs * 1000,
        step.tenantId,
        step.id,
        step.leaseOwner,
        step.standingAuthorizationId,
        step.timeZone,
      ]
    );
    return result.affectedRows === 1;
  }

  async beginCallDispatch(step: ClaimedOperatorAppointment): Promise<boolean> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE operator_appointments
          SET callDispatchStartedAt = CURRENT_TIMESTAMP(3)
        WHERE tenantId = ? AND id = ?
          AND status = 'running'
          AND leaseOwner = ?
          AND leaseExpiresAt > CURRENT_TIMESTAMP(3)
          AND callDispatchStartedAt IS NULL
          AND callSid IS NULL
          AND standingAuthorizationId <=> ?`,
      [step.tenantId, step.id, step.leaseOwner, step.standingAuthorizationId]
    );
    return result.affectedRows === 1;
  }

  async completeStep(
    step: ClaimedOperatorAppointment,
    resultValue: unknown
  ): Promise<boolean> {
    const row =
      resultValue && typeof resultValue === "object"
        ? (resultValue as {
            callSid?: unknown;
            calendarEventId?: unknown;
            calendarStatus?: unknown;
          })
        : {};
    const callSid = typeof row.callSid === "string" && row.callSid.trim()
      ? row.callSid.trim()
      : null;
    const calendarEventId =
      typeof row.calendarEventId === "string" && row.calendarEventId.trim()
        ? row.calendarEventId.trim()
        : null;
    const calendarStatus =
      typeof row.calendarStatus === "string" && row.calendarStatus.trim()
        ? row.calendarStatus.trim()
        : null;
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE operator_appointments
          SET status = 'completed',
              callSid = COALESCE(?, callSid),
              calendarEventId = COALESCE(?, calendarEventId),
              calendarStatus = COALESCE(?, calendarStatus),
              resultJson = ?,
              completedAt = CURRENT_TIMESTAMP(3),
              leaseOwner = NULL,
              leaseExpiresAt = NULL,
              heartbeatAt = NULL
        WHERE tenantId = ? AND id = ?
          AND status IN ('leased','running')
          AND leaseOwner = ?
          AND standingAuthorizationId <=> ?
          AND timeZone = ?`,
      [
        callSid,
        calendarEventId,
        calendarStatus,
        resultValue === undefined ? null : JSON.stringify(resultValue),
        step.tenantId,
        step.id,
        step.leaseOwner,
        step.standingAuthorizationId,
        step.timeZone,
      ]
    );
    return result.affectedRows === 1;
  }

  async failStep(
    step: ClaimedOperatorAppointment,
    error: unknown,
    retryDelayMs: number
  ): Promise<"retry_scheduled" | "dead_letter" | "lease_lost"> {
    const connection = await this.pool.getConnection();
    const errorText = messageOf(error);
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<AppointmentRow[]>(
        `SELECT *
           FROM operator_appointments
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
      if (row.callDispatchStartedAt != null) {
        await connection.execute(
          `UPDATE operator_appointments
              SET status = 'dead_letter',
                  lastError = ?,
                  leaseOwner = NULL,
                  leaseExpiresAt = NULL,
                  heartbeatAt = NULL
            WHERE tenantId = ? AND id = ?`,
          [
            `call_dispatch_failed_or_uncertain_no_redial: ${errorText}`,
            row.tenantId,
            row.id,
          ]
        );
        await connection.commit();
        return "dead_letter";
      }
      const executionSnapshotChanged =
        row.standingAuthorizationId !== step.standingAuthorizationId ||
        row.timeZone !== step.timeZone;
      if (executionSnapshotChanged) {
        // Authority/timezone refresh is a fencing event, not an execution
        // attempt. Requeue the refreshed row and refund the claim that only
        // observed a stale snapshot so the current week's appointment cannot
        // be dead-lettered solely because rotation happened on the final
        // configured attempt.
        await connection.execute(
          `UPDATE operator_appointments
              SET status = 'retry_scheduled',
                  lastError = ?,
                  scheduledFor = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MICROSECOND),
                  attemptCount = GREATEST(attemptCount - 1, 0),
                  leaseOwner = NULL,
                  leaseExpiresAt = NULL,
                  heartbeatAt = NULL
            WHERE tenantId = ? AND id = ?
              AND callDispatchStartedAt IS NULL`,
          [
            `execution_snapshot_refreshed: ${errorText}`,
            retryDelayMs * 1000,
            row.tenantId,
            row.id,
          ]
        );
        await connection.commit();
        return "retry_scheduled";
      }
      if (Number(row.attemptCount) >= Number(row.maxAttempts)) {
        await connection.execute(
          `UPDATE operator_appointments
              SET status = 'dead_letter',
                  lastError = ?,
                  leaseOwner = NULL,
                  leaseExpiresAt = NULL,
                  heartbeatAt = NULL
            WHERE tenantId = ? AND id = ?`,
          [errorText, row.tenantId, row.id]
        );
        await connection.commit();
        return "dead_letter";
      }
      await connection.execute(
        `UPDATE operator_appointments
            SET status = 'retry_scheduled',
                lastError = ?,
                scheduledFor = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MICROSECOND),
                leaseOwner = NULL,
                leaseExpiresAt = NULL,
                heartbeatAt = NULL
          WHERE tenantId = ? AND id = ?`,
        [errorText, retryDelayMs * 1000, row.tenantId, row.id]
      );
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
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE operator_appointments
          SET status = 'dead_letter',
              lastError = CASE
                WHEN callDispatchStartedAt IS NOT NULL AND callSid IS NULL
                  THEN 'call_dispatch_outcome_uncertain_no_redial'
                ELSE 'lease_expired_after_final_attempt'
              END,
              leaseOwner = NULL,
              leaseExpiresAt = NULL,
              heartbeatAt = NULL
        WHERE status IN ('leased','running')
          AND leaseExpiresAt IS NOT NULL
          AND leaseExpiresAt <= CURRENT_TIMESTAMP(3)
          AND (attemptCount >= maxAttempts OR callDispatchStartedAt IS NOT NULL)`
    );
    return result.affectedRows;
  }

  async listPendingCallbacks(input: {
    tenantId: string;
    canonicalOperatorId: string;
    weekStart: string;
    excludeIdempotencyKey?: string | null;
  }): Promise<Array<{ id: string; idempotencyKey: string }>> {
    const params: unknown[] = [
      input.tenantId,
      input.canonicalOperatorId,
      input.weekStart,
    ];
    const exclude = input.excludeIdempotencyKey?.trim();
    const exclusionSql = exclude ? " AND idempotencyKey <> ?" : "";
    if (exclude) params.push(exclude);
    const [rows] = await this.pool.execute<
      Array<RowDataPacket & { id: string; idempotencyKey: string }>
    >(
      `SELECT id, idempotencyKey
         FROM operator_appointments
        WHERE tenantId = ?
          AND canonicalOperatorId = ?
          AND weekStart = ?
          AND appointmentKind = 'weekly_planning_callback'
          AND status IN ('scheduled','retry_scheduled')${exclusionSql}
        ORDER BY scheduledFor, createdAt, id`,
      params
    );
    return rows.map(row => ({
      id: String(row.id),
      idempotencyKey: String(row.idempotencyKey),
    }));
  }

  async cancelPendingCallbacks(input: {
    tenantId: string;
    canonicalOperatorId: string;
    weekStart: string;
    excludeIdempotencyKey?: string | null;
  }): Promise<number> {
    const params: unknown[] = [
      input.tenantId,
      input.canonicalOperatorId,
      input.weekStart,
    ];
    const exclude = input.excludeIdempotencyKey?.trim();
    const exclusionSql = exclude ? " AND idempotencyKey <> ?" : "";
    if (exclude) params.push(exclude);
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE operator_appointments
          SET status = 'cancelled',
              leaseOwner = NULL,
              leaseExpiresAt = NULL,
              heartbeatAt = NULL,
              completedAt = CURRENT_TIMESTAMP(3)
        WHERE tenantId = ?
          AND canonicalOperatorId = ?
          AND weekStart = ?
          AND appointmentKind = 'weekly_planning_callback'
          AND status IN ('scheduled','retry_scheduled')${exclusionSql}`,
      params
    );
    return result.affectedRows;
  }

  async recordCalendarResult(input: {
    tenantId: string;
    appointmentId: string;
    status: string;
    eventId?: string | null;
  }): Promise<void> {
    await this.pool.execute(
      `UPDATE operator_appointments
          SET calendarStatus = ?,
              calendarEventId = COALESCE(?, calendarEventId)
        WHERE tenantId = ? AND id = ?`,
      [
        input.status,
        input.eventId ?? null,
        input.tenantId,
        input.appointmentId,
      ]
    );
  }

  async markMissedByCallSid(callSid: string): Promise<AppointmentRow | null> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<AppointmentRow[]>(
        `SELECT *
           FROM operator_appointments
          WHERE callSid = ?
          LIMIT 1
          FOR UPDATE`,
        [callSid]
      );
      const row = rows[0];
      if (!row) {
        await connection.commit();
        return null;
      }
      if (row.status !== "missed") {
        await connection.execute(
          `UPDATE operator_appointments
              SET status = 'missed'
            WHERE id = ?`,
          [row.id]
        );
      }
      await connection.commit();
      return { ...row, status: "missed" };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

}
