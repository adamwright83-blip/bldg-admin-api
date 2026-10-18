import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GoalCycleStore } from "./goalCycleStore";
import { GoalCycleWorker } from "./goalCycleWorker";
import { runGoalCycleStep, type GoalCycleStepDeps } from "./goalCycleStep";

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
    new URL("../../../drizzle/0103_persistent_growth_goal_cycles.sql", import.meta.url),
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

  it("duplicate recurring scheduled ticks for one run collapse to a single survivor", async () => {
    // Production held six live scheduled ticks for one run (restarts enqueued extras,
    // and each re-queued itself every hour forever).
    const runId = await insertRun({ tenantId: "tenant-a" });
    const store = new GoalCycleStore(pool, { perTenantConcurrency: 10 });
    for (let i = 0; i < 6; i++) {
      await store.enqueue({
        tenantId: "tenant-a",
        goalRunId: runId,
        triggerType: "scheduled_tick",
        triggerSourceReference: `autonomous_supervisor:heartbeat:${i}`,
        idempotencyKey: `auto_tick:${runId}:hour-${i}`,
        availableAt: new Date(Date.now() - 1_000),
      });
    }
    const nextEvaluationAt = new Date(Date.now() + 3_600_000).toISOString();
    for (let i = 0; i < 6; i++) {
      const step = await store.claimNextStep({ leaseOwner: "worker-a", leaseMs: 30_000 });
      expect(step).not.toBeNull();
      await store.markRunning(step!);
      expect(await store.completeStep(step!, { nextEvaluationAt })).toBe(true);
    }
    const live = await rows<RowDataPacket>(
      "SELECT id, availableAt FROM goal_cycle_requests WHERE goalRunId = ? AND triggerType = 'scheduled_tick' AND status IN ('queued','retry_scheduled','leased','running')",
      [runId]
    );
    expect(live).toHaveLength(1);
    const [{ completed }] = await rows<RowDataPacket>(
      "SELECT COUNT(*) AS completed FROM goal_cycle_requests WHERE goalRunId = ? AND status = 'completed'",
      [runId]
    );
    expect(Number(completed)).toBe(5);
    expect(await store.claimNextStep({ leaseOwner: "worker-a", leaseMs: 30_000 })).toBeNull();
  });

  it("a single scheduled tick still re-queues itself for the next evaluation", async () => {
    const runId = await insertRun({ tenantId: "tenant-a" });
    const store = new GoalCycleStore(pool);
    const queued = await store.enqueue({
      tenantId: "tenant-a",
      goalRunId: runId,
      triggerType: "scheduled_tick",
      triggerSourceReference: "autonomous_supervisor:heartbeat",
      idempotencyKey: `auto_tick:${runId}:once`,
      availableAt: new Date(Date.now() - 1_000),
    });
    const step = await store.claimNextStep({ leaseOwner: "worker-a", leaseMs: 30_000 });
    await store.markRunning(step!);
    const nextEvaluationAt = new Date(Date.now() + 3_600_000);
    expect(await store.completeStep(step!, { nextEvaluationAt: nextEvaluationAt.toISOString() })).toBe(true);
    const [row] = await rows<RowDataPacket>("SELECT status, availableAt FROM goal_cycle_requests WHERE id = ?", [queued.id]);
    expect(row.status).toBe("queued");
    expect(new Date(row.availableAt).getTime()).toBeGreaterThan(Date.now() + 3_000_000);
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

  // Stage 1 1D: the supervisor only keeps one live tick; preparation lives in the leased step.

  const liveTicks = (runId: string) =>
    rows<RowDataPacket>(
      "SELECT id, status, idempotencyKey, availableAt FROM goal_cycle_requests WHERE goalRunId = ? AND triggerType = 'scheduled_tick' AND status IN ('queued','retry_scheduled','leased','running')",
      [runId]
    );

  it("the supervisor replaces a dead-lettered tick with one new tick and never revives it", async () => {
    const runId = await insertRun({ tenantId: "tenant-a" });
    const store = new GoalCycleStore(pool);
    const dead = await store.enqueue({
      tenantId: "tenant-a",
      goalRunId: runId,
      triggerType: "scheduled_tick",
      triggerSourceReference: "autonomous_supervisor:heartbeat",
      idempotencyKey: `scheduled_tick:${runId}`,
      availableAt: new Date(Date.now() - 1_000),
      maxAttempts: 1,
    });
    const step = await store.claimNextStep({ leaseOwner: "worker-a", leaseMs: 30_000 });
    expect(step?.id).toBe(dead.id);
    await store.markRunning(step!);
    expect(await store.failStep(step!, new Error("source outage"), 10)).toBe("dead_letter");
    expect(await liveTicks(runId)).toHaveLength(0);

    const ensure = () =>
      store.ensureLiveScheduledTick({
        tenantId: "tenant-a",
        goalRunId: runId,
        triggerSourceReference: "autonomous_supervisor:heartbeat",
      });
    const first = await ensure();
    expect(first).toMatchObject({ created: true, reason: "created" });
    // Every later sweep finds the live tick; no extra rows accumulate.
    for (let sweep = 0; sweep < 3; sweep++) {
      expect(await ensure()).toEqual({ id: first.id, created: false, reason: "live_tick_exists" });
    }

    const ticks = await rows<RowDataPacket>(
      "SELECT id, status, idempotencyKey FROM goal_cycle_requests WHERE goalRunId = ? AND triggerType = 'scheduled_tick'",
      [runId]
    );
    expect(ticks).toHaveLength(2);
    expect(ticks.find(tick => tick.id === dead.id)?.status).toBe("dead_letter");
    expect(ticks.find(tick => tick.id === first.id)).toMatchObject({
      status: "queued",
      idempotencyKey: `scheduled_tick:${runId}:after:${dead.id}`,
    });
    const [deadLetter] = await rows<RowDataPacket>(
      "SELECT requestId FROM goal_cycle_dead_letters WHERE requestId = ?",
      [dead.id]
    );
    expect(deadLetter?.requestId).toBe(dead.id);
  });

  it("overlapping supervisors create exactly one tick between them", async () => {
    const runId = await insertRun({ tenantId: "tenant-a" });
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        new GoalCycleStore(pool).ensureLiveScheduledTick({
          tenantId: "tenant-a",
          goalRunId: runId,
          triggerSourceReference: `autonomous_supervisor:replica-${index}`,
        })
      )
    );
    expect(results.filter(result => result.created)).toHaveLength(1);
    expect(await liveTicks(runId)).toHaveLength(1);
  });

  it("the supervisor does not schedule a paused run", async () => {
    const runId = await insertRun({ tenantId: "tenant-a", status: "paused" });
    const store = new GoalCycleStore(pool);
    expect(
      await store.ensureLiveScheduledTick({
        tenantId: "tenant-a",
        goalRunId: runId,
        triggerSourceReference: "autonomous_supervisor:heartbeat",
      })
    ).toEqual({ id: null, created: false, reason: "run_not_active" });
    expect(await liveTicks(runId)).toHaveLength(0);
  });

  it("an event cycle's completion moves the live tick earlier instead of adding a second", async () => {
    const runId = await insertRun({ tenantId: "tenant-a" });
    const store = new GoalCycleStore(pool);
    const tick = await store.ensureLiveScheduledTick({
      tenantId: "tenant-a",
      goalRunId: runId,
      triggerSourceReference: "autonomous_supervisor:heartbeat",
      availableAt: new Date(Date.now() + 7_200_000),
    });
    await store.enqueue({
      tenantId: "tenant-a",
      goalRunId: runId,
      triggerType: "human_result",
      triggerSourceReference: "operator:debrief:1",
      idempotencyKey: "human:debrief:1",
      availableAt: new Date(Date.now() - 1_000),
    });
    const step = await store.claimNextStep({ leaseOwner: "worker-a", leaseMs: 30_000 });
    expect(step?.triggerType).toBe("human_result");
    await store.markRunning(step!);
    const nextEvaluationAt = new Date(Date.now() + 3_600_000);
    expect(await store.completeStep(step!, { nextEvaluationAt: nextEvaluationAt.toISOString() })).toBe(true);

    const live = await liveTicks(runId);
    expect(live).toHaveLength(1);
    expect(live[0]!.id).toBe(tick.id);
    expect(new Date(live[0]!.availableAt).getTime()).toBeLessThan(Date.now() + 3_700_000);
  });

  it("a failure inside the leased step is retried through failStep, keeping the cycle id", async () => {
    const runId = await insertRun({ tenantId: "tenant-a" });
    const store = new GoalCycleStore(pool);
    const queued = await store.enqueue({
      tenantId: "tenant-a",
      goalRunId: runId,
      triggerType: "human_result",
      triggerSourceReference: "operator:debrief:2",
      idempotencyKey: "human:debrief:2",
      availableAt: new Date(Date.now() - 1_000),
    });
    let attempts = 0;
    const prepare = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("model timeout while preparing");
      return { id: "proposal-1" };
    });
    const decide = vi.fn(async (input: { cycleId: string }) => ({
      decision: { id: `decision-${input.cycleId}`, selectionKind: "wait", selectedRef: null, selectedReasonCode: "NO_ELIGIBLE_WORK" },
      created: true,
      objective: null,
    }));
    const deps = {
      registry: {} as never,
      appointmentStore: {} as never,
      evaluateRun: async () => ({
        run: {
          id: runId,
          status: "active",
          canonicalOperatorId: "canonical:tenant-a",
          operatorUserId: "operator:tenant-a",
          nextEvaluationAt: new Date(Date.now() + 3_600_000),
        },
        completed: false,
        observation: null,
      }),
      evaluatePolicy: async () => ({
        status: "allowed",
        authority: "automatic",
        exactAction: "persistent_operator.goal_cycle.prepare",
        riskClass: "INTERNAL_REVERSIBLE",
      }),
      resolveIdentity: async () => ({ ok: true, identity: {} }),
      resolveTimeZone: async () => "America/Los_Angeles",
      prepare,
      scheduleCall: async () => ({ scheduled: false }),
      decide,
    } as unknown as GoalCycleStepDeps;
    const worker = new GoalCycleWorker(
      store,
      { leaseOwner: "worker-retry", leaseMs: 5_000, pollMs: 20, concurrency: 1, retryBaseMs: 10 },
      input => runGoalCycleStep(input, deps)
    );
    void worker.start();
    try {
      for (let i = 0; i < 200; i++) {
        const [row] = await rows<RowDataPacket>("SELECT status FROM goal_cycle_requests WHERE id = ?", [queued.id]);
        if (row?.status === "completed") break;
        await wait(25);
      }
    } finally {
      await worker.stop();
    }
    const history = await rows<RowDataPacket>(
      "SELECT eventType FROM goal_cycle_history WHERE requestId = ? ORDER BY id",
      [queued.id]
    );
    expect(history.map(event => event.eventType)).toEqual([
      "cycle.queued",
      "cycle.leased",
      "cycle.retry_scheduled",
      "cycle.leased",
      "cycle.completed",
    ]);
    expect(prepare).toHaveBeenCalledTimes(2);
    // The retry is the same occurrence: one decision, under the request's own id.
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ cycleId: queued.id }));
  });
});
