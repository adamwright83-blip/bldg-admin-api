/**
 * Real-MySQL characterization of the procurement durable workflow store.
 *
 * Persistent Growth Slice B will extract these lease mechanics into a
 * domain-neutral module and must keep procurement working unchanged. The
 * guarantees below (one lease per step, crash recovery by lease expiry,
 * backoff, dead letters, deadline sweeps) only mean something against a real
 * database: `FOR UPDATE SKIP LOCKED` and `CURRENT_TIMESTAMP(3)` cannot be
 * proven by a fake.
 *
 * Requires DATABASE_URL pointing at a MySQL 8 server the test may create
 * databases on. The suite creates its own throwaway database, applies the
 * real procurement migrations to it, and drops it afterwards. It never
 * touches the database named in DATABASE_URL.
 */
import { randomUUID } from "node:crypto";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadProcurementMigrations, runProcurementMigrations } from "./migrations";
import { ProcurementWorker } from "./worker";
import { ProcurementWorkflowStore, type ClaimedWorkflowStep } from "./workflowStore";

const DATABASE_URL = process.env.DATABASE_URL;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let admin: mysql.Connection;
let pool: Pool;
let store: ProcurementWorkflowStore;
let databaseName = "";

async function rows<T extends RowDataPacket>(sql: string, params: unknown[] = []) {
  const [result] = await pool.query<T[]>(sql, params);
  return result;
}

async function stepRow(id: string) {
  const [row] = await rows<RowDataPacket>(
    "SELECT status, attempt_count, lease_owner, lease_expires_at, available_at, last_error FROM procurement_workflow_steps WHERE id = ?",
    [id]
  );
  return row;
}

async function workflowStatus(id: string) {
  const [row] = await rows<RowDataPacket>("SELECT status FROM procurement_workflows WHERE id = ?", [id]);
  return row?.status as string | undefined;
}

async function history(stepId: string) {
  return (
    await rows<RowDataPacket>(
      "SELECT event_type, lease_owner, attempt_number FROM procurement_execution_history WHERE step_id = ? ORDER BY id",
      [stepId]
    )
  ).map(r => r.event_type as string);
}

async function create(over: { maxAttempts?: number; availableAt?: Date; deadlineAt?: Date | null; key?: string } = {}) {
  const key = over.key ?? randomUUID();
  return store.createWorkflowWithStep({
    workflowKey: `wf-${key}`,
    workflowType: "test.workflow",
    stepKey: "only",
    stepType: "test.step",
    idempotencyKey: `idem-${key}`,
    payload: { key },
    maxAttempts: over.maxAttempts,
    availableAt: over.availableAt,
    deadlineAt: over.deadlineAt,
  });
}

async function claimAs(owner: string, leaseMs = 60_000) {
  return store.claimNextStep({ leaseOwner: owner, leaseMs });
}

describe.skipIf(!DATABASE_URL)("procurement workflow store — real MySQL", () => {
  beforeAll(async () => {
    const url = new URL(DATABASE_URL!);
    databaseName = `procurement_worker_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    url.pathname = "/";
    admin = await mysql.createConnection(url.toString());
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    url.pathname = `/${databaseName}`;
    pool = mysql.createPool({ uri: url.toString(), connectionLimit: 12, supportBigNumbers: true, bigNumberStrings: true });
    await runProcurementMigrations(pool, await loadProcurementMigrations());
    store = new ProcurementWorkflowStore(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (admin && databaseName) await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    await admin?.end();
  });

  beforeEach(async () => {
    // Each test starts from an empty queue; history and dead letters cascade.
    await pool.query("DELETE FROM procurement_workflows");
  });

  it("creating the same workflow twice is idempotent", async () => {
    const a = await create({ key: "same" });
    const b = await create({ key: "same" });
    expect(b).toEqual(a);
    const [{ steps }] = await rows<RowDataPacket>("SELECT COUNT(*) AS steps FROM procurement_workflow_steps");
    expect(Number(steps)).toBe(1);
    expect(await history(a.stepId)).toEqual(["step.created"]);
  });

  it("a claim leases the step to exactly one owner and counts the attempt", async () => {
    const { stepId, workflowId } = await create();
    const claimed = await claimAs("owner-a");
    expect(claimed).toMatchObject({ id: stepId, workflowId, attemptCount: 1, leaseOwner: "owner-a", payload: { key: expect.any(String) } });
    expect(await claimAs("owner-b")).toBeNull();
    expect(await stepRow(stepId)).toMatchObject({ status: "leased", attempt_count: 1, lease_owner: "owner-a" });
    expect(await workflowStatus(workflowId)).toBe("running");
    expect(await history(stepId)).toEqual(["step.created", "step.leased"]);
  });

  it("concurrent claimers never lease the same step twice", async () => {
    const created = await Promise.all(Array.from({ length: 15 }, () => create()));
    const owners = Array.from({ length: 8 }, (_, i) => `racer-${i}`);
    const claimed: ClaimedWorkflowStep[] = [];
    await Promise.all(
      owners.map(async owner => {
        for (;;) {
          const next = await claimAs(owner);
          if (!next) return;
          claimed.push(next);
        }
      })
    );
    const ids = claimed.map(c => c.id).sort();
    expect(ids).toEqual(created.map(c => c.stepId).sort());
    expect(new Set(ids).size).toBe(15);
  });

  it("a step is not claimable before its availableAt", async () => {
    await create({ availableAt: new Date(Date.now() + 60_000) });
    expect(await claimAs("owner-a")).toBeNull();
  });

  it("markRunning and heartbeat succeed only for the lease owner, and heartbeat extends the lease", async () => {
    const { stepId } = await create();
    const claimed = (await claimAs("owner-a", 2_000))!;
    expect(await store.markRunning({ ...claimed, leaseOwner: "intruder" })).toBe(false);
    expect(await store.markRunning(claimed)).toBe(true);
    expect((await stepRow(stepId)).status).toBe("running");

    const before = new Date((await stepRow(stepId)).lease_expires_at).getTime();
    expect(await store.heartbeat({ ...claimed, leaseOwner: "intruder" }, 60_000)).toBe(false);
    expect(await store.heartbeat(claimed, 60_000)).toBe(true);
    const after = new Date((await stepRow(stepId)).lease_expires_at).getTime();
    expect(after - before).toBeGreaterThan(50_000);
  });

  it("a crashed owner's step is reclaimed after the lease expires, and the stale owner can no longer finish it", async () => {
    const { stepId } = await create();
    const stale = (await claimAs("crashed", 150))!;
    expect(await claimAs("rescuer")).toBeNull();
    await wait(300);

    const rescued = (await claimAs("rescuer"))!;
    expect(rescued).toMatchObject({ id: stepId, attemptCount: 2, leaseOwner: "rescuer" });
    expect(await store.completeStep(stale, "late")).toBe(false);
    expect(await store.failStep(stale, new Error("late"), 1_000)).toBe("lease_lost");
    expect(await store.completeStep(rescued, "ok")).toBe(true);
    expect((await stepRow(stepId)).status).toBe("completed");
  });

  it("completing the last step completes the workflow and clears the lease", async () => {
    const { stepId, workflowId } = await create();
    const claimed = (await claimAs("owner-a"))!;
    await store.markRunning(claimed);
    expect(await store.completeStep(claimed, { ok: true })).toBe(true);
    expect(await stepRow(stepId)).toMatchObject({ status: "completed", lease_owner: null, lease_expires_at: null });
    expect(await workflowStatus(workflowId)).toBe("completed");
    expect(await history(stepId)).toEqual(["step.created", "step.leased", "step.completed"]);
  });

  it("a failure with attempts left schedules a retry that is claimable only after the delay", async () => {
    const { stepId, workflowId } = await create({ maxAttempts: 3 });
    const claimed = (await claimAs("owner-a"))!;
    expect(await store.failStep(claimed, new Error("provider down"), 400)).toBe("retry_scheduled");
    expect(await stepRow(stepId)).toMatchObject({ status: "retry_scheduled", lease_owner: null, last_error: "provider down" });
    expect(await workflowStatus(workflowId)).toBe("pending");
    expect(await claimAs("owner-b")).toBeNull();

    await wait(600);
    expect(await claimAs("owner-b")).toMatchObject({ id: stepId, attemptCount: 2 });
  });

  it("a failure on the final attempt dead-letters the step and the workflow", async () => {
    const { stepId, workflowId } = await create({ maxAttempts: 1 });
    const claimed = (await claimAs("owner-a"))!;
    expect(await store.failStep(claimed, new Error("fatal"), 1_000)).toBe("dead_letter");
    expect((await stepRow(stepId)).status).toBe("dead_letter");
    expect(await workflowStatus(workflowId)).toBe("dead_letter");
    const letters = await rows<RowDataPacket>("SELECT reason, error_text, attempt_count FROM procurement_dead_letters WHERE source_id = ?", [stepId]);
    expect(letters).toEqual([expect.objectContaining({ reason: "attempts_exhausted", error_text: "fatal", attempt_count: 1 })]);
    expect(await history(stepId)).toContain("step.dead_lettered");
  });

  it("a step past its deadline is never claimed, and the sweep dead-letters it", async () => {
    const { stepId, workflowId } = await create({ deadlineAt: new Date(Date.now() + 300) });
    await wait(600);
    expect(await claimAs("owner-a")).toBeNull();
    expect(await store.deadLetterExpiredSteps()).toBe(1);
    expect((await stepRow(stepId)).status).toBe("dead_letter");
    expect(await workflowStatus(workflowId)).toBe("dead_letter");
    const [letter] = await rows<RowDataPacket>("SELECT reason FROM procurement_dead_letters WHERE source_id = ?", [stepId]);
    expect(letter.reason).toBe("deadline_exceeded");
  });

  it("KNOWN GAP: a step whose owner crashes on its final attempt stays leased forever", async () => {
    // Current behavior, recorded so an extraction cannot silently keep or lose
    // it: the claim query requires attempt_count < max_attempts, and the sweep
    // only handles pending/ready/retry_scheduled steps that have a deadline. A
    // final-attempt crash is therefore neither reclaimed nor dead-lettered.
    const { stepId } = await create({ maxAttempts: 1 });
    await claimAs("crashed", 100);
    await wait(250);
    expect(await claimAs("rescuer")).toBeNull();
    expect(await store.deadLetterExpiredSteps()).toBe(0);
    expect((await stepRow(stepId)).status).toBe("leased");
  });

  it("two real workers drain a shared queue with every step handled exactly once", async () => {
    const created = await Promise.all(Array.from({ length: 20 }, () => create()));
    const handledBy = new Map<string, string[]>();
    const makeWorker = (owner: string) =>
      new ProcurementWorker(
        store,
        new Map([
          [
            "test.step",
            async ({ step }) => {
              handledBy.set(step.id, [...(handledBy.get(step.id) ?? []), owner]);
              await wait(10);
              return { owner };
            },
          ],
        ]),
        { leaseOwner: owner, leaseMs: 10_000, pollMs: 20, concurrency: 3, retryBaseMs: 100 }
      );
    const a = makeWorker("worker-a");
    const b = makeWorker("worker-b");
    void a.start();
    void b.start();

    const started = Date.now();
    for (;;) {
      const [{ done }] = await rows<RowDataPacket>("SELECT COUNT(*) AS done FROM procurement_workflow_steps WHERE status = 'completed'");
      if (Number(done) === 20) break;
      if (Date.now() - started > 20_000) throw new Error("workers did not drain the queue");
      await wait(50);
    }
    await Promise.all([a.stop(), b.stop()]);

    expect([...handledBy.keys()].sort()).toEqual(created.map(c => c.stepId).sort());
    expect([...handledBy.values()].every(owners => owners.length === 1)).toBe(true);
  }, 30_000);

  it("a worker recovers a step abandoned by a crashed process", async () => {
    const { stepId } = await create();
    await claimAs("crashed-process", 200);
    const rescuer = new ProcurementWorker(
      store,
      new Map([["test.step", async () => "recovered"]]),
      { leaseOwner: "rescuer", leaseMs: 10_000, pollMs: 25, concurrency: 1, retryBaseMs: 100 }
    );
    void rescuer.start();

    const started = Date.now();
    while ((await stepRow(stepId)).status !== "completed") {
      if (Date.now() - started > 10_000) throw new Error("step was not recovered");
      await wait(50);
    }
    await rescuer.stop();
    expect((await stepRow(stepId)).attempt_count).toBe(2);
    expect(await history(stepId)).toEqual(["step.created", "step.leased", "step.leased", "step.completed"]);
  }, 20_000);
});
