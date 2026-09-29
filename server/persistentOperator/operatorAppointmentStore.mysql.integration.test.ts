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

  it("allows only one missed-call follow-up claim", async () => {
    const store = new OperatorAppointmentStore(pool);
    const scheduled = await store.enqueue(appointment());
    const step = await store.claimNextStep({ leaseOwner: "worker", leaseMs: 10_000 });
    expect(step).not.toBeNull();
    expect(await store.markRunning(step!)).toBe(true);
    expect(
      await store.completeStep(step!, { callSid: "CA1234567890" })
    ).toBe(true);
    await store.markMissedByCallSid("CA1234567890");

    const first = await store.claimMissedFollowup("CA1234567890");
    const second = await store.claimMissedFollowup("CA1234567890");
    expect(first).toMatchObject({ id: scheduled.id });
    expect(second).toBeNull();
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
