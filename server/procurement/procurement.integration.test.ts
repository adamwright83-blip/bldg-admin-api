import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getProcurementMigrationStatus,
  loadProcurementMigrations,
  runProcurementMigrations,
} from "./migrations";
import { ProcurementWorker, type ProcurementStepHandler } from "./worker";
import { ProcurementWorkflowStore } from "./workflowStore";

const databaseUrl = process.env.PROCUREMENT_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const tableDropOrder = [
  "procurement_dead_letters",
  "procurement_execution_history",
  "procurement_operator_gates",
  "procurement_outbox_events",
  "procurement_workflow_steps",
  "procurement_workflows",
  "held_schema_migrations",
];

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

describeWithDatabase("procurement workflow foundation", () => {
  let pool: Pool;
  let store: ProcurementWorkflowStore;

  beforeAll(async () => {
    const parsed = new URL(databaseUrl!);
    if (!/procurement[_-]test/i.test(parsed.pathname)) {
      throw new Error("PROCUREMENT_TEST_DATABASE_URL must name a dedicated procurement test database");
    }
    pool = mysql.createPool({
      uri: databaseUrl!,
      connectionLimit: 12,
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
    await pool.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of tableDropOrder) await pool.query(`DROP TABLE IF EXISTS \`${table}\``);
    await pool.query("SET FOREIGN_KEY_CHECKS = 1");
    const migrations = await loadProcurementMigrations();
    const result = await runProcurementMigrations(pool, migrations, { lockTimeoutSeconds: 2 });
    expect(result.every(row => row.result === "applied")).toBe(true);
    store = new ProcurementWorkflowStore(pool);
  }, 20_000);

  afterAll(async () => {
    if (!pool) return;
    await pool.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of tableDropOrder) await pool.query(`DROP TABLE IF EXISTS \`${table}\``);
    await pool.query("SET FOREIGN_KEY_CHECKS = 1");
    await pool.end();
  });

  it("records checksums and skips already-applied migrations", async () => {
    const migrations = await loadProcurementMigrations();
    const status = await getProcurementMigrationStatus(pool, migrations);
    expect(status.map(row => row.state)).toEqual(["applied", "applied"]);
    const secondRun = await runProcurementMigrations(pool, migrations, { lockTimeoutSeconds: 2 });
    expect(secondRun.map(row => row.result)).toEqual(["skipped", "skipped"]);
  });

  it("allows only one worker to claim a step", async () => {
    const created = await store.createWorkflowWithStep({
      workflowKey: `duplicate-${Date.now()}`,
      workflowType: "foundation_test",
      stepKey: "only-once",
      stepType: "foundation.noop",
      idempotencyKey: `duplicate-idempotency-${Date.now()}`,
    });
    const [first, second] = await Promise.all([
      store.claimNextStep({ leaseOwner: "worker-a", leaseMs: 5_000 }),
      store.claimNextStep({ leaseOwner: "worker-b", leaseMs: 5_000 }),
    ]);
    const claims = [first, second].filter(step => step?.id === created.stepId);
    expect(claims).toHaveLength(1);
    const claimed = claims[0]!;
    expect(await store.markRunning(claimed)).toBe(true);
    expect(await store.heartbeat(claimed, 5_000)).toBe(true);
    expect(await store.completeStep(claimed, { ok: true })).toBe(true);
  });

  it("returns the same workflow and step without duplicating creation history", async () => {
    const suffix = Date.now();
    const input = {
      workflowKey: `idempotent-${suffix}`,
      workflowType: "foundation_test",
      stepKey: "same-step",
      stepType: "foundation.noop",
      idempotencyKey: `idempotent-step-${suffix}`,
    };
    const first = await store.createWorkflowWithStep(input);
    const second = await store.createWorkflowWithStep(input);
    expect(second).toEqual(first);
    const [history] = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM procurement_execution_history WHERE step_id = ? AND event_type = 'step.created'",
      [first.stepId],
    );
    expect(Number(history[0]?.count)).toBe(1);
    const claimed = await store.claimNextStep({ leaseOwner: "idempotency-test", leaseMs: 5_000 });
    expect(claimed?.id).toBe(first.stepId);
    expect(await store.completeStep(claimed!, { ok: true })).toBe(true);
  });

  it("retries and then dead-letters an exhausted step", async () => {
    const created = await store.createWorkflowWithStep({
      workflowKey: `dead-letter-${Date.now()}`,
      workflowType: "foundation_test",
      stepKey: "always-fails",
      stepType: "foundation.fail",
      idempotencyKey: `dead-letter-idempotency-${Date.now()}`,
      maxAttempts: 2,
    });
    const first = await store.claimNextStep({ leaseOwner: "worker-retry", leaseMs: 5_000 });
    expect(first?.id).toBe(created.stepId);
    expect(await store.markRunning(first!)).toBe(true);
    expect(await store.failStep(first!, new Error("first failure"), 0)).toBe("retry_scheduled");

    const second = await store.claimNextStep({ leaseOwner: "worker-retry", leaseMs: 5_000 });
    expect(second?.id).toBe(created.stepId);
    expect(await store.markRunning(second!)).toBe(true);
    expect(await store.failStep(second!, new Error("second failure"), 0)).toBe("dead_letter");
    const [deadLetters] = await pool.execute<RowDataPacket[]>(
      "SELECT reason, attempt_count FROM procurement_dead_letters WHERE source_id = ?",
      [created.stepId],
    );
    expect(deadLetters).toMatchObject([{ reason: "attempts_exhausted", attempt_count: 2 }]);
  });

  it("reclaims an abandoned lease after it expires", async () => {
    const suffix = Date.now();
    const created = await store.createWorkflowWithStep({
      workflowKey: `lease-recovery-${suffix}`,
      workflowType: "foundation_test",
      stepKey: "recover-me",
      stepType: "foundation.noop",
      idempotencyKey: `lease-recovery-step-${suffix}`,
    });
    const abandoned = await store.claimNextStep({ leaseOwner: "dead-worker", leaseMs: 50 });
    expect(abandoned?.id).toBe(created.stepId);
    await new Promise(resolve => setTimeout(resolve, 75));
    const recovered = await store.claimNextStep({ leaseOwner: "replacement-worker", leaseMs: 5_000 });
    expect(recovered).toMatchObject({ id: created.stepId, attemptCount: 2 });
    expect(await store.completeStep(recovered!, { recovered: true })).toBe(true);
  });

  it("fails closed when a ready step passes its deadline", async () => {
    const suffix = Date.now();
    const created = await store.createWorkflowWithStep({
      workflowKey: `deadline-${suffix}`,
      workflowType: "foundation_test",
      stepKey: "too-late",
      stepType: "foundation.noop",
      idempotencyKey: `deadline-step-${suffix}`,
      deadlineAt: new Date(Date.now() - 1_000),
    });
    expect(await store.deadLetterExpiredSteps()).toBeGreaterThanOrEqual(1);
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT status FROM procurement_workflow_steps WHERE id = ?",
      [created.stepId],
    );
    expect(rows[0]?.status).toBe("dead_letter");
  });

  it("runs two worker instances without executing a job twice", async () => {
    const created = await store.createWorkflowWithStep({
      workflowKey: `two-workers-${Date.now()}`,
      workflowType: "foundation_test",
      stepKey: "shared-job",
      stepType: "foundation.count",
      idempotencyKey: `two-workers-idempotency-${Date.now()}`,
    });
    let executions = 0;
    const handler: ProcurementStepHandler = async () => {
      executions += 1;
      await new Promise(resolve => setTimeout(resolve, 40));
      return { executions };
    };
    const handlers = new Map([["foundation.count", handler]]);
    const baseOptions = { leaseMs: 1_000, pollMs: 10, concurrency: 1, retryBaseMs: 10 };
    const workerA = new ProcurementWorker(store, handlers, { ...baseOptions, leaseOwner: "instance-a" });
    const workerB = new ProcurementWorker(store, handlers, { ...baseOptions, leaseOwner: "instance-b" });
    void workerA.start();
    void workerB.start();
    await waitFor(async () => {
      const [rows] = await pool.execute<RowDataPacket[]>(
        "SELECT status FROM procurement_workflow_steps WHERE id = ?",
        [created.stepId],
      );
      return rows[0]?.status === "completed";
    });
    await Promise.all([workerA.stop(), workerB.stop()]);
    expect(executions).toBe(1);
  });

  it("worker retries a failing handler and dead-letters it", async () => {
    const created = await store.createWorkflowWithStep({
      workflowKey: `worker-dead-letter-${Date.now()}`,
      workflowType: "foundation_test",
      stepKey: "worker-failure",
      stepType: "foundation.always-fail",
      idempotencyKey: `worker-dead-letter-idempotency-${Date.now()}`,
      maxAttempts: 2,
    });
    const handlers = new Map<string, ProcurementStepHandler>([
      ["foundation.always-fail", async () => { throw new Error("intentional test failure"); }],
    ]);
    const worker = new ProcurementWorker(store, handlers, {
      leaseOwner: "dead-letter-worker",
      leaseMs: 1_000,
      pollMs: 10,
      concurrency: 1,
      retryBaseMs: 10,
    });
    void worker.start();
    await waitFor(async () => {
      const [rows] = await pool.execute<RowDataPacket[]>(
        "SELECT status FROM procurement_workflow_steps WHERE id = ?",
        [created.stepId],
      );
      return rows[0]?.status === "dead_letter";
    });
    await worker.stop();
    const [history] = await pool.execute<RowDataPacket[]>(
      "SELECT event_type FROM procurement_execution_history WHERE step_id = ? ORDER BY id",
      [created.stepId],
    );
    expect(history.map(row => row.event_type)).toContain("step.retry_scheduled");
    expect(history.map(row => row.event_type)).toContain("step.dead_lettered");
  });
});
