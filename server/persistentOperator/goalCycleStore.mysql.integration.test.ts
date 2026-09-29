import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GoalCycleStore } from "./goalCycleStore";

const DATABASE_URL = process.env.DATABASE_URL;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let admin: mysql.Connection;
let pool: Pool;
let databaseName = "";

async function rows<T extends RowDataPacket>(sql: string, params: unknown[] = []) {
  const [result] = await pool.query<T[]>(sql, params);
  return result;
}

async function applyPr2Schema() {
  const sql = await readFile(
    new URL("../../drizzle/0103_persistent_growth_goal_cycles.sql", import.meta.url),
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

async function insertRun(input: {
  tenantId: string;
  id?: string;
  status?: "active" | "paused" | "completed" | "superseded";
}) {
  const id = input.id ?? randomUUID();
  await pool.execute(
    `INSERT INTO macro_goal_runs
      (id, tenantId, canonicalOperatorId, operatorUserId, macroGoalId, verticalKey,
       status, goalSnapshotJson, metricKey, targetValue, unit, baselinePrecision,
       baselineCoverage, policyVersion)
     VALUES (?, ?, ?, ?, ?, 'fixture', ?, '{}', 'metric', 10, 'units', 'exact',
             'complete', 'pr2-test')`,
    [
      id,
      input.tenantId,
      `canonical:${input.tenantId}`,
      `operator:${input.tenantId}`,
      id,
      input.status ?? "active",
    ]
  );
  return id;
}

describe.skipIf(!DATABASE_URL)("goal cycle store — real MySQL", () => {
  beforeAll(async () => {
    const url = new URL(DATABASE_URL!);
    databaseName = `goal_cycle_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
    await applyPr2Schema();
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (admin && databaseName) {
      await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    }
    await admin?.end();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM goal_cycle_dead_letters");
    await pool.query("DELETE FROM goal_cycle_history");
    await pool.query("DELETE FROM goal_cycle_requests");
    await pool.query("DELETE FROM goal_cycle_tenant_state");
    await pool.query("DELETE FROM macro_goal_runs");
  });

  it("deduplicates the same tenant trigger into one durable logical cycle", async () => {
    const runId = await insertRun({ tenantId: "tenant-a" });
    const store = new GoalCycleStore(pool);
    const a = await store.enqueue({
      tenantId: "tenant-a",
      goalRunId: runId,
      triggerType: "business_event",
      triggerSourceReference: "event:123",
      idempotencyKey: "business:event:123",
    });
    const b = await store.enqueue({
      tenantId: "tenant-a",
      goalRunId: runId,
      triggerType: "business_event",
      triggerSourceReference: "event:123",
      idempotencyKey: "business:event:123",
    });
    expect(a.created).toBe(true);
    expect(b).toEqual({ id: a.id, created: false });
    const [{ count }] = await rows<RowDataPacket>(
      "SELECT COUNT(*) AS count FROM goal_cycle_requests WHERE tenantId = 'tenant-a'"
    );
    expect(Number(count)).toBe(1);
  });

  it("rejects an idempotency key that is already bound to a different goal run", async () => {
    const firstRunId = await insertRun({ tenantId: "tenant-a" });
    const secondRunId = await insertRun({ tenantId: "tenant-a" });
    const store = new GoalCycleStore(pool);
    await store.enqueue({
      tenantId: "tenant-a",
      goalRunId: firstRunId,
      triggerType: "scheduled_tick",
      triggerSourceReference: "operator:a:day:1",
      idempotencyKey: "shared-key",
    });
    await expect(store.enqueue({
      tenantId: "tenant-a",
      goalRunId: secondRunId,
      triggerType: "scheduled_tick",
      triggerSourceReference: "operator:b:day:1",
      idempotencyKey: "shared-key",
    })).rejects.toThrow(/idempotency key is bound to different work/);
  });

  it("paused goals retain queued work but do not execute until resumed", async () => {
    const runId = await insertRun({ tenantId: "tenant-a", status: "paused" });
    const store = new GoalCycleStore(pool);
    const queued = await store.enqueue({
      tenantId: "tenant-a",
      goalRunId: runId,
      triggerType: "scheduled_tick",
      idempotencyKey: "scheduled:1",
    });
    expect(await store.claimNextStep({ leaseOwner: "worker-a", leaseMs: 1_000 })).toBeNull();
    const [before] = await rows<RowDataPacket>(
      "SELECT status FROM goal_cycle_requests WHERE id = ?",
      [queued.id]
    );
    expect(before.status).toBe("queued");

    await pool.execute(
      "UPDATE macro_goal_runs SET status = 'active' WHERE tenantId = ? AND id = ?",
      ["tenant-a", runId]
    );
    expect(await store.claimNextStep({ leaseOwner: "worker-a", leaseMs: 1_000 }))
      .toMatchObject({ id: queued.id, tenantId: "tenant-a", goalRunId: runId });
  });

  it("a fresh store resumes an abandoned lease after expiry without duplicate execution", async () => {
    const runId = await insertRun({ tenantId: "tenant-a" });
    const firstStore = new GoalCycleStore(pool);
    const queued = await firstStore.enqueue({
      tenantId: "tenant-a",
      goalRunId: runId,
      triggerType: "manual_replan",
      idempotencyKey: "restart:1",
      maxAttempts: 3,
    });
    const stale = await firstStore.claimNextStep({ leaseOwner: "dead-process", leaseMs: 100 });
    expect(stale).toMatchObject({ id: queued.id, attemptCount: 1 });
    await wait(250);

    const restartedStore = new GoalCycleStore(pool);
    const recovered = await restartedStore.claimNextStep({ leaseOwner: "restarted", leaseMs: 1_000 });
    expect(recovered).toMatchObject({
      id: queued.id,
      attemptCount: 2,
      leaseOwner: "restarted",
    });
    expect(await firstStore.completeStep(stale!, "late")).toBe(false);
  });

  it("dead-letters an abandoned final-attempt lease instead of inventing another attempt", async () => {
    const runId = await insertRun({ tenantId: "tenant-a" });
    const store = new GoalCycleStore(pool);
    const queued = await store.enqueue({
      tenantId: "tenant-a",
      goalRunId: runId,
      triggerType: "manual_replan",
      idempotencyKey: "final:1",
      maxAttempts: 1,
    });
    await store.claimNextStep({ leaseOwner: "dead-process", leaseMs: 100 });
    await wait(250);
    expect(await store.claimNextStep({ leaseOwner: "rescuer", leaseMs: 1_000 })).toBeNull();
    expect(await store.deadLetterExpiredSteps()).toBe(1);

    const [cycle] = await rows<RowDataPacket>(
      "SELECT status, attemptCount, leaseOwner, lastError FROM goal_cycle_requests WHERE id = ?",
      [queued.id]
    );
    expect(cycle).toMatchObject({
      status: "dead_letter",
      attemptCount: 1,
      leaseOwner: null,
      lastError: "lease_expired_after_final_attempt",
    });
  });

  it("uses persisted fair tenant ordering so a deep tenant queue cannot starve another tenant", async () => {
    const runA = await insertRun({ tenantId: "tenant-a" });
    const runB = await insertRun({ tenantId: "tenant-b" });
    const store = new GoalCycleStore(pool, { perTenantConcurrency: 1 });

    for (let index = 0; index < 3; index += 1) {
      await store.enqueue({
        tenantId: "tenant-a",
        goalRunId: runA,
        triggerType: "business_event",
        idempotencyKey: `a:${index}`,
      });
    }
    await store.enqueue({
      tenantId: "tenant-b",
      goalRunId: runB,
      triggerType: "business_event",
      idempotencyKey: "b:0",
    });

    const first = await store.claimNextStep({ leaseOwner: "worker-a", leaseMs: 10_000 });
    expect(first?.tenantId).toBe("tenant-a");
    await store.completeStep(first!, "ok");

    const second = await store.claimNextStep({ leaseOwner: "worker-a", leaseMs: 10_000 });
    expect(second?.tenantId).toBe("tenant-b");
  });

  it("concurrent workers cannot lease the same cycle twice", async () => {
    const runId = await insertRun({ tenantId: "tenant-a" });
    const store = new GoalCycleStore(pool);
    const queued = await store.enqueue({
      tenantId: "tenant-a",
      goalRunId: runId,
      triggerType: "human_result",
      idempotencyKey: "race:1",
    });

    const claims = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        store.claimNextStep({ leaseOwner: `worker-${index}`, leaseMs: 10_000 })
      )
    );
    const claimed = claims.filter(Boolean);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ id: queued.id });
  });
});
