/* LEGACY DAYFORGE COMPATIBILITY: historical SaaS SQL table names retained for the production schema; current product is JOYSTICK. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PERSISTENT_OPERATOR_ENTITLEMENT } from "../../../shared/saasTenant";

/**
 * Real-MySQL proof for Stage 1 · 1D: the bootstrap sweep never prepares and
 * leaves each active run exactly one live goal cycle without minting rows;
 * a preparation failure in the leased worker is retried through failStep.
 */
const prep = vi.hoisted(() => ({ prepare: 0, schedule: 0 }));
vi.mock("../../strategy/strategicPreparation", async importOriginal => ({
  ...(await importOriginal<typeof import("../../strategy/strategicPreparation")>()),
  prepareStrategicProposal: vi.fn(async () => {
    prep.prepare += 1;
    throw new Error("bootstrap must never prepare");
  }),
}));
vi.mock("./strategicCallAuthorization", async importOriginal => ({
  ...(await importOriginal<typeof import("./strategicCallAuthorization")>()),
  scheduleAuthorizedStrategicCall: vi.fn(async () => {
    prep.schedule += 1;
  }),
}));

const { ensureAutonomousGoalBootstrap } = await import("./autonomousWorkerService");
const { GoalCycleStore } = await import("./goalCycleStore");
const { GoalCycleWorker } = await import("./goalCycleWorker");
const { OperatorAppointmentStore } = await import("./operatorAppointmentStore");
const { runGoalCycleOccurrence } = await import("./goalCycleOccurrence");

const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;
const zone = "America/Los_Angeles";

describeMysql("autonomous goal bootstrap on MySQL", () => {
  let sql: mysql.Connection;
  let pool: mysql.Pool;
  let store: InstanceType<typeof GoalCycleStore>;
  let appointments: InstanceType<typeof OperatorAppointmentStore>;

  beforeAll(async () => {
    sql = await mysql.createConnection(process.env.DATABASE_URL!);
    pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 6 });
    store = new GoalCycleStore(pool, { perTenantConcurrency: 4 });
    appointments = new OperatorAppointmentStore(pool);
  });
  afterAll(async () => {
    await sql?.end();
    await pool?.end();
  });

  async function operatorWithRun() {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const tenantId = `boot-1d-${suffix}`;
    const operator = `boot-owner-${suffix}`;
    await sql.execute(
      "INSERT INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES (?,?,?,?,?,?,?,?,'active','laundry_fluff_fold')",
      [tenantId, tenantId, "Boot test", "Boot test", "#123456", "Op", "op@example.invalid", zone]
    );
    await sql.execute("INSERT INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,?,?,'user','password')", [tenantId, operator, "Op", "op@example.invalid"]);
    await sql.execute("INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,'owner',true)", [tenantId, operator]);
    await sql.execute("INSERT INTO dayforge_saas_entitlements (tenantId,entitlementKey,source,enabled) VALUES (?,?,'manual',true)", [tenantId, PERSISTENT_OPERATOR_ENTITLEMENT]);
    const goalId = randomUUID();
    await sql.execute(
      "INSERT INTO operator_macro_goals (id,tenantId,operatorUserId,objective,metricKey,targetValue,unit,source,sourceNote,status) VALUES (?,?,?,?,?,?,?,'operator_attested','test','active')",
      [goalId, tenantId, operator, "Get to 50 active customers", "active_customers", 50, "customers"]
    );
    const runId = randomUUID();
    await sql.execute(
      `INSERT INTO macro_goal_runs
        (id, tenantId, canonicalOperatorId, operatorUserId, macroGoalId, verticalKey,
         status, goalSnapshotJson, metricKey, targetValue, unit, baselinePrecision,
         baselineCoverage, policyVersion)
       VALUES (?, ?, ?, ?, ?, 'laundry_fluff_fold', 'active', '{}', 'active_customers', 50, 'customers', 'exact', 'complete', 'v1')`,
      [runId, tenantId, `tenant:${tenantId}:operator:${operator}`, operator, goalId]
    );
    return { tenantId, operator, runId };
  }

  async function cycles(tenantId: string, runId: string) {
    const [rows] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT id, idempotencyKey, triggerType, status, availableAt FROM goal_cycle_requests WHERE tenantId = ? AND goalRunId = ? ORDER BY createdAt, id",
      [tenantId, runId]
    );
    return rows;
  }
  const live = (rows: mysql.RowDataPacket[]) => rows.filter(r => ["queued", "retry_scheduled", "leased", "running"].includes(String(r.status)));

  it("a dead-lettered scheduled tick plus repeated sweeps leaves exactly one live tick, no auto_tick rows, and never prepares", async () => {
    // Stage 1 · 1B: the dead occurrence stays dead (its id is its decision identity);
    // the sweep queues one new occurrence after it, and further sweeps add nothing.
    const t = await operatorWithRun();
    // The run's scheduled tick exhausted its attempts.
    const tickId = randomUUID();
    await sql.execute(
      "INSERT INTO goal_cycle_requests (id, tenantId, goalRunId, triggerType, triggerSourceReference, idempotencyKey, status, availableAt, maxAttempts, attemptCount, lastError) VALUES (?, ?, ?, 'scheduled_tick', 'test', ?, 'dead_letter', NOW(3), 5, 5, 'attempts_exhausted')",
      [tickId, t.tenantId, t.runId, `scheduled_tick:${t.runId}`]
    );
    const start = new Date();
    for (const hoursLater of [0, 0, 1, 2, 5]) {
      await ensureAutonomousGoalBootstrap({ store, appointmentStore: appointments, now: new Date(start.getTime() + hoursLater * 3_600_000) });
    }
    const rows = await cycles(t.tenantId, t.runId);
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.id === tickId)?.status).toBe("dead_letter");
    const next = live(rows);
    expect(next).toHaveLength(1);
    expect(next[0]!.idempotencyKey).toBe(`scheduled_tick:${t.runId}:after:${tickId}`);
    expect(rows.filter(r => String(r.idempotencyKey).startsWith("auto_tick:"))).toEqual([]);
    // The next occurrence waits an hour from the dead letter.
    expect(new Date(next[0]!.availableAt).getTime()).toBeGreaterThanOrEqual(start.getTime() + 3_600_000 - 5_000);
    expect(prep.prepare).toBe(0);
    expect(prep.schedule).toBe(0);
  });

  it("a run with no cycle gets exactly one scheduled tick across repeated sweeps", async () => {
    const t = await operatorWithRun();
    for (let i = 0; i < 3; i += 1) {
      await ensureAutonomousGoalBootstrap({ store, appointmentStore: appointments });
    }
    const rows = await cycles(t.tenantId, t.runId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.idempotencyKey).toBe(`scheduled_tick:${t.runId}:after:first`);
    expect(live(rows)).toHaveLength(1);
    expect(prep.prepare).toBe(0);
    // Claimable: the worker only claims tenants that have a fairness row.
    const [state] = await sql.execute<mysql.RowDataPacket[]>("SELECT tenantId FROM goal_cycle_tenant_state WHERE tenantId = ?", [t.tenantId]);
    expect(state).toHaveLength(1);
  });

  it("an in-flight cycle of any trigger counts as live, so the sweep adds nothing", async () => {
    const t = await operatorWithRun();
    await store.enqueue({ tenantId: t.tenantId, goalRunId: t.runId, triggerType: "manual_replan", idempotencyKey: `manual:${t.runId}` });
    await ensureAutonomousGoalBootstrap({ store, appointmentStore: appointments });
    const rows = await cycles(t.tenantId, t.runId);
    expect(rows.map(r => r.triggerType)).toEqual(["manual_replan"]);
  });

  it("a preparation failure in the leased worker is retried through failStep, then the cycle decides once", async () => {
    const t = await operatorWithRun();
    const { id } = await store.ensureLiveScheduledTick({ tenantId: t.tenantId, goalRunId: t.runId });
    let attempts = 0;
    const decide = vi.fn(async () => ({
      decision: { id: randomUUID(), selectionKind: "wait", selectedRef: null, selectedReasonCode: "TEST" },
      created: true,
      objective: null,
    }) as never);
    const worker = new GoalCycleWorker(
      store,
      { leaseOwner: `boot-${randomUUID()}`, leaseMs: 30_000, pollMs: 25, concurrency: 4, retryBaseMs: 25 },
      input =>
        input.tenantId !== t.tenantId
          ? Promise.resolve({})
          : runGoalCycleOccurrence(input, {
              loadRun: async () => ({ id: t.runId, status: "active", canonicalOperatorId: `tenant:${t.tenantId}:operator:${t.operator}`, operatorUserId: t.operator }),
              evaluatePolicy: async () => ({ allowed: true, authority: "automatic", standingAuthorizationId: null, standingAuthorizationVersion: null }),
              evaluateRun: async () => ({ run: { id: t.runId, status: "active", operatorUserId: t.operator, nextEvaluationAt: null }, completed: false, observation: null }),
              prepare: async () => {
                attempts += 1;
                if (attempts === 1) throw new Error("diagnosis reader unavailable");
              },
              decide,
            })
    );
    void worker.start();
    const deadline = Date.now() + 25_000;
    try {
      while (Date.now() < deadline) {
        const [rows] = await sql.execute<mysql.RowDataPacket[]>("SELECT status FROM goal_cycle_requests WHERE tenantId = ? AND id = ?", [t.tenantId, id]);
        if (rows[0]?.status === "completed") break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    } finally {
      await worker.stop();
    }
    const [history] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT eventType, errorText FROM goal_cycle_history WHERE tenantId = ? AND requestId = ? ORDER BY id",
      [t.tenantId, id]
    );
    const events = history.map(row => String(row.eventType));
    expect(events).toContain("cycle.retry_scheduled");
    expect(history.find(row => row.eventType === "cycle.retry_scheduled")?.errorText).toBe("diagnosis reader unavailable");
    expect(events.at(-1)).toBe("cycle.completed");
    expect(attempts).toBe(2);
    expect(decide).toHaveBeenCalledTimes(1);
  }, 40_000);
});
