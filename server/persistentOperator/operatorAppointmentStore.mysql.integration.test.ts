import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OperatorAppointmentStore } from "./operatorAppointmentStore";

const DATABASE_URL = process.env.DATABASE_URL;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let admin: mysql.Connection;
let pool: Pool;
let databaseName = "";

async function rows<T extends RowDataPacket>(sql: string, params: unknown[] = []) {
  const [result] = await pool.query<T[]>(sql, params);
  return result;
}

async function applySchema() {
  await pool.query(`
    CREATE TABLE agent_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenantId VARCHAR(64) NOT NULL DEFAULT 'default',
      agentType ENUM(
        'resident_agent','operator_voice_agent','vendor_agent','driver_agent',
        'gm_agent','building_agent','collections_agent','operator_task_agent',
        'system_agent'
      ) NOT NULL,
      actorType ENUM('human','voice','resident_chat','driver','vendor','ai_agent','system') NOT NULL,
      toolName VARCHAR(128) NOT NULL,
      status ENUM('success','failed','approval_required','blocked') NOT NULL
    )
  `);
  const sql = await readFile(
    new URL("../../drizzle/0104_persistent_operator_authority_appointments.sql", import.meta.url),
    "utf8"
  );
  for (const statement of sql
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map(value => value.trim())
    .filter(Boolean)) {
    await pool.query(statement);
  }
}

function appointment(overrides: Partial<Parameters<OperatorAppointmentStore["enqueue"]>[0]> = {}) {
  return {
    tenantId: "tenant-a",
    canonicalOperatorId: "tenant:tenant-a:operator:adam",
    operatorUserId: "adam",
    appointmentKind: "sunday_weekly_planning" as const,
    weekStart: "2026-10-05",
    scheduledFor: new Date(Date.now() - 1_000),
    timeZone: "America/Los_Angeles",
    source: "standing_weekly_authorization" as const,
    sourceReference: "operator_rule:2026-09-28:sunday_weekly_planning",
    standingAuthorizationId: "auth-a",
    unprompted: true,
    idempotencyKey: "sunday:2026-10-05",
    ...overrides,
  };
}

describe.skipIf(!DATABASE_URL)("operator appointment store — real MySQL", () => {
  beforeAll(async () => {
    const url = new URL(DATABASE_URL!);
    databaseName = `operator_appt_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    url.pathname = "/";
    admin = await mysql.createConnection(url.toString());
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    url.pathname = `/${databaseName}`;
    pool = mysql.createPool({
      uri: url.toString(),
      connectionLimit: 12,
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
    await applySchema();
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (admin && databaseName) {
      await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    }
    await admin?.end();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM operator_appointments");
    await pool.query("DELETE FROM tenant_standing_authorizations");
  });

  it("creates at most one unprompted appointment for the same operator week", async () => {
    const store = new OperatorAppointmentStore(pool);
    const first = await store.enqueue(appointment());
    const second = await store.enqueue(appointment());
    expect(first.created).toBe(true);
    expect(second).toEqual({ id: first.id, created: false });
    const [{ count }] = await rows<RowDataPacket>(
      "SELECT COUNT(*) AS count FROM operator_appointments"
    );
    expect(Number(count)).toBe(1);
  });

  it("duplicate workers cannot lease the same call twice", async () => {
    const store = new OperatorAppointmentStore(pool);
    const scheduled = await store.enqueue(appointment());
    const claims = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        store.claimNextStep({
          leaseOwner: `worker-${index}`,
          leaseMs: 10_000,
        })
      )
    );
    const claimed = claims.filter(Boolean);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ id: scheduled.id });
  });

  it("survives worker restart and reclaims an expired callback lease", async () => {
    const firstStore = new OperatorAppointmentStore(pool);
    const scheduled = await firstStore.enqueue(
      appointment({
        appointmentKind: "weekly_planning_callback",
        source: "explicit_operator_request",
        sourceReference: "conversation:1",
        standingAuthorizationId: null,
        unprompted: false,
        idempotencyKey: "callback:1",
      })
    );
    const stale = await firstStore.claimNextStep({
      leaseOwner: "dead-worker",
      leaseMs: 100,
    });
    expect(stale).toMatchObject({ id: scheduled.id, attemptCount: 1 });
    await wait(250);

    const restarted = new OperatorAppointmentStore(pool);
    const recovered = await restarted.claimNextStep({
      leaseOwner: "new-worker",
      leaseMs: 10_000,
    });
    expect(recovered).toMatchObject({
      id: scheduled.id,
      attemptCount: 2,
      leaseOwner: "new-worker",
    });
  });

  it("never reclaims an appointment after external call dispatch begins", async () => {
    const store = new OperatorAppointmentStore(pool);
    const scheduled = await store.enqueue(appointment());
    const step = await store.claimNextStep({ leaseOwner: "worker", leaseMs: 100 });
    expect(step).toMatchObject({ id: scheduled.id });
    expect(await store.markRunning(step!)).toBe(true);
    expect(await store.beginCallDispatch(step!)).toBe(true);
    expect(await store.beginCallDispatch(step!)).toBe(false);

    await wait(250);
    expect(
      await store.claimNextStep({ leaseOwner: "rescuer", leaseMs: 10_000 })
    ).toBeNull();
    expect(await store.deadLetterExpiredSteps()).toBe(1);
    const [row] = await rows<RowDataPacket>(
      "SELECT status, lastError, attemptCount FROM operator_appointments WHERE id = ?",
      [scheduled.id]
    );
    expect(row).toMatchObject({
      status: "dead_letter",
      lastError: "call_dispatch_outcome_uncertain_no_redial",
      attemptCount: 1,
    });
  });

  it("does not retry when provider execution fails after dispatch was claimed", async () => {
    const store = new OperatorAppointmentStore(pool);
    const scheduled = await store.enqueue(appointment({ idempotencyKey: "dispatch-fail" }));
    const step = await store.claimNextStep({ leaseOwner: "worker", leaseMs: 10_000 });
    expect(step).toMatchObject({ id: scheduled.id });
    expect(await store.markRunning(step!)).toBe(true);
    expect(await store.beginCallDispatch(step!)).toBe(true);
    expect(await store.failStep(step!, new Error("provider outcome unknown"), 100))
      .toBe("dead_letter");
    expect(
      await store.claimNextStep({ leaseOwner: "rescuer", leaseMs: 10_000 })
    ).toBeNull();
  });

  it("an idempotent callback retry does not cancel its own durable row", async () => {
    const store = new OperatorAppointmentStore(pool);
    const callbackInput = appointment({
      appointmentKind: "weekly_planning_callback",
      source: "explicit_operator_request",
      sourceReference: "conversation:same",
      standingAuthorizationId: null,
      unprompted: false,
      idempotencyKey: "callback:same",
    });
    const first = await store.enqueue(callbackInput);
    await store.cancelPendingCallbacks({
      tenantId: callbackInput.tenantId,
      canonicalOperatorId: callbackInput.canonicalOperatorId,
      weekStart: callbackInput.weekStart,
      excludeIdempotencyKey: callbackInput.idempotencyKey,
    });
    const second = await store.enqueue(callbackInput);
    expect(second).toEqual({ id: first.id, created: false });
    const [row] = await rows<RowDataPacket>(
      "SELECT status FROM operator_appointments WHERE id = ?",
      [first.id]
    );
    expect(row.status).toBe("scheduled");
  });

  it("refreshes an unclaimed Sunday appointment when its standing authorization rotates", async () => {
    const store = new OperatorAppointmentStore(pool);
    const first = await store.enqueue(appointment());
    const refreshedSlot = new Date(Date.now() + 3_600_000);

    const second = await store.enqueue(
      appointment({
        scheduledFor: refreshedSlot,
        timeZone: "America/New_York",
        standingAuthorizationId: "auth-b",
      })
    );

    expect(second).toEqual({ id: first.id, created: false });
    const [row] = await rows<RowDataPacket>(
      `SELECT standingAuthorizationId,
              timeZone,
              scheduledFor = ? AS slotMatches,
              status
         FROM operator_appointments
        WHERE id = ?`,
      [refreshedSlot, first.id]
    );
    expect(row).toMatchObject({
      standingAuthorizationId: "auth-b",
      timeZone: "America/New_York",
      status: "scheduled",
    });
    expect(Boolean(row.slotMatches)).toBe(true);
  });

  it("refreshes rotated Sunday authority without resetting retry backoff", async () => {
    const store = new OperatorAppointmentStore(pool);
    const first = await store.enqueue(appointment());
    const step = await store.claimNextStep({
      leaseOwner: "worker",
      leaseMs: 10_000,
    });
    expect(step).toMatchObject({ id: first.id });
    expect(await store.failStep(step!, new Error("transient guard failure"), 60_000))
      .toBe("retry_scheduled");

    const [before] = await rows<RowDataPacket>(
      "SELECT scheduledFor FROM operator_appointments WHERE id = ?",
      [first.id]
    );

    await store.enqueue(
      appointment({
        scheduledFor: new Date(Date.now() + 3_600_000),
        timeZone: "America/New_York",
        standingAuthorizationId: "auth-b",
      })
    );

    const [after] = await rows<RowDataPacket>(
      "SELECT scheduledFor, standingAuthorizationId, timeZone, status FROM operator_appointments WHERE id = ?",
      [first.id]
    );
    expect(after).toMatchObject({
      standingAuthorizationId: "auth-b",
      timeZone: "America/New_York",
      status: "retry_scheduled",
    });
    expect((after.scheduledFor as Date).getTime())
      .toBe((before.scheduledFor as Date).getTime());
  });

  it("refreshes claimed Sunday authority by revoking and requeueing the stale lease", async () => {
    const store = new OperatorAppointmentStore(pool);
    const first = await store.enqueue(appointment());
    const claimed = await store.claimNextStep({
      leaseOwner: "worker",
      leaseMs: 10_000,
    });
    expect(claimed).toMatchObject({ id: first.id, attemptCount: 1 });

    await store.enqueue(
      appointment({
        scheduledFor: new Date(Date.now() + 3_600_000),
        timeZone: "America/New_York",
        standingAuthorizationId: "auth-b",
      })
    );

    expect(await store.markRunning(claimed!)).toBe(false);
    expect(await store.beginCallDispatch(claimed!)).toBe(false);
    expect(
      await store.failStep(
        claimed!,
        new Error("standing authorization rotated before dispatch"),
        60_000
      )
    ).toBe("lease_lost");

    const [row] = await rows<RowDataPacket>(
      "SELECT standingAuthorizationId, timeZone, status, attemptCount, leaseOwner, callDispatchStartedAt FROM operator_appointments WHERE id = ?",
      [first.id]
    );
    expect(row).toMatchObject({
      standingAuthorizationId: "auth-b",
      timeZone: "America/New_York",
      status: "retry_scheduled",
      attemptCount: 0,
      leaseOwner: null,
      callDispatchStartedAt: null,
    });
  });

  it("rejects stale completion after Sunday authority or timezone refresh", async () => {
    const store = new OperatorAppointmentStore(pool);
    const first = await store.enqueue(appointment());
    const claimed = await store.claimNextStep({
      leaseOwner: "worker",
      leaseMs: 10_000,
    });
    expect(claimed).toMatchObject({ id: first.id });
    expect(await store.markRunning(claimed!)).toBe(true);

    await store.enqueue(
      appointment({
        scheduledFor: new Date(Date.now() + 3_600_000),
        timeZone: "America/New_York",
        standingAuthorizationId: "auth-b",
      })
    );

    expect(
      await store.completeStep(claimed!, {
        skipped: "outside_authorized_sunday_window",
      })
    ).toBe(false);
    expect(
      await store.failStep(
        claimed!,
        new Error("authority/timezone execution snapshot changed"),
        60_000
      )
    ).toBe("lease_lost");

    const [row] = await rows<RowDataPacket>(
      "SELECT standingAuthorizationId, timeZone, status, attemptCount, completedAt FROM operator_appointments WHERE id = ?",
      [first.id]
    );
    expect(row).toMatchObject({
      standingAuthorizationId: "auth-b",
      timeZone: "America/New_York",
      status: "retry_scheduled",
      attemptCount: 0,
      completedAt: null,
    });
  });

  it("refunds the final attempt immediately when a claimed Sunday snapshot is refreshed", async () => {
    const store = new OperatorAppointmentStore(pool);
    const first = await store.enqueue(
      appointment({
        maxAttempts: 1,
        idempotencyKey: "final-attempt-snapshot-refresh",
      })
    );
    const claimed = await store.claimNextStep({
      leaseOwner: "worker",
      leaseMs: 100,
    });
    expect(claimed).toMatchObject({
      id: first.id,
      attemptCount: 1,
      maxAttempts: 1,
    });

    await store.enqueue(
      appointment({
        maxAttempts: 1,
        idempotencyKey: "final-attempt-snapshot-refresh",
        scheduledFor: new Date(Date.now() + 3_600_000),
        timeZone: "America/New_York",
        standingAuthorizationId: "auth-b",
      })
    );

    await wait(250);
    expect(await store.deadLetterExpiredSteps()).toBe(0);

    const [row] = await rows<RowDataPacket>(
      "SELECT standingAuthorizationId, timeZone, status, attemptCount, leaseOwner, completedAt FROM operator_appointments WHERE id = ?",
      [first.id]
    );
    expect(row).toMatchObject({
      standingAuthorizationId: "auth-b",
      timeZone: "America/New_York",
      status: "retry_scheduled",
      attemptCount: 0,
      leaseOwner: null,
      completedAt: null,
    });

    const refreshed = await store.claimNextStep({
      leaseOwner: "fresh-worker",
      leaseMs: 10_000,
    });
    expect(refreshed).toMatchObject({
      id: first.id,
      attemptCount: 1,
      maxAttempts: 1,
      standingAuthorizationId: "auth-b",
      timeZone: "America/New_York",
    });
  });

  it("rescheduling callbacks does not consume or cancel the weekly unprompted row", async () => {
    const store = new OperatorAppointmentStore(pool);
    const weekly = await store.enqueue(appointment());
    await store.enqueue(
      appointment({
        appointmentKind: "weekly_planning_callback",
        source: "explicit_operator_request",
        sourceReference: "conversation:2",
        standingAuthorizationId: null,
        unprompted: false,
        idempotencyKey: "callback:2",
      })
    );
    expect(
      await store.cancelPendingCallbacks({
        tenantId: "tenant-a",
        canonicalOperatorId: "tenant:tenant-a:operator:adam",
        weekStart: "2026-10-05",
      })
    ).toBe(1);
    const [row] = await rows<RowDataPacket>(
      "SELECT status, unprompted FROM operator_appointments WHERE id = ?",
      [weekly.id]
    );
    expect(row).toMatchObject({ status: "scheduled", unprompted: 1 });
  });
});
