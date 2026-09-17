import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { opsTaskEvents, opsTasks } from "../drizzle/schema";
import { getDb } from "./db";
import { completeOpsTask, createOpsTask, recordOpsTaskReply } from "./opsTasks";
import { listBehavioralLedgerEventsForCorrelation } from "./behavioralLedger/behavioralLedger";

/**
 * Real-MySQL coverage for the concurrency invariant PR #154's fake-store
 * tests can only model, not prove: `completeTaskWithEvent`'s
 * `UPDATE ... WHERE status != 'completed'` guard must be the actual
 * database's atomic compare-and-set under real concurrent connections, not
 * merely correct against a single-threaded in-memory fake with no `await`
 * between check and write. This file requires DATABASE_URL and is excluded
 * from the default `pnpm test` run (see vitest.integration.config.ts);
 * CI wires it in explicitly (see goldline-fast-smoke.yml).
 */

const TENANT = "default";

async function createFixtureTask(overrides: { assignedTo?: string } = {}) {
  const task = await createOpsTask({
    tenantId: TENANT,
    lane: "level_4",
    level: "4",
    taskType: "manual_operator_task",
    title: `MySQL concurrency fixture ${randomUUID().slice(0, 8)}`,
    assignedTo: overrides.assignedTo ?? null,
  });
  return task.id;
}

describe("ops task completion — real MySQL concurrency", () => {
  it("two concurrent completeOpsTask calls yield exactly one canonical completion", async () => {
    const taskId = await createFixtureTask();

    const [a, b] = await Promise.all([
      completeOpsTask({ tenantId: TENANT, taskId, completedBy: "operator-a", outcome: "Handled by A" }),
      completeOpsTask({ tenantId: TENANT, taskId, completedBy: "operator-b", outcome: "Handled by B" }),
    ]);

    // Both callers resolve to a truthful completed state — neither call
    // throws or returns a task that claims to still be open.
    expect(a.status).toBe("completed");
    expect(b.status).toBe("completed");

    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const finalTask = await db
      .select()
      .from(opsTasks)
      .where(and(eq(opsTasks.tenantId, TENANT), eq(opsTasks.id, taskId)))
      .limit(1);
    expect(finalTask[0]?.status).toBe("completed");

    const completedEvents = await db
      .select()
      .from(opsTaskEvents)
      .where(and(eq(opsTaskEvents.tenantId, TENANT), eq(opsTaskEvents.taskId, taskId), eq(opsTaskEvents.eventType, "completed")));
    // Exactly one authoritative ops_task_events.completed row — the
    // invariant the transactional completeTaskWithEvent exists to
    // guarantee under real concurrent connections.
    expect(completedEvents).toHaveLength(1);

    const ledgerEvents = await listBehavioralLedgerEventsForCorrelation(TENANT, `ops_task:${taskId}`);
    const completedLedgerRows = ledgerEvents.filter(e => e.eventType === "COMPLETED");
    // Exactly one behavioral COMPLETED row, mirrored from that one
    // authoritative ops_task_events row.
    expect(completedLedgerRows).toHaveLength(1);
  }, 20000);

  it("a resident reply racing a plain completion still yields one canonical completion against real MySQL", async () => {
    const taskId = await createFixtureTask();

    await Promise.all([
      completeOpsTask({ tenantId: TENANT, taskId, completedBy: "operator-a", outcome: "Handled manually" }),
      recordOpsTaskReply({ tenantId: TENANT, taskId, message: "On our way.", repliedBy: "operator-b" }),
    ]);

    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const completedEvents = await db
      .select()
      .from(opsTaskEvents)
      .where(and(eq(opsTaskEvents.tenantId, TENANT), eq(opsTaskEvents.taskId, taskId), eq(opsTaskEvents.eventType, "completed")));
    expect(completedEvents).toHaveLength(1);

    const finalTask = await db
      .select()
      .from(opsTasks)
      .where(and(eq(opsTasks.tenantId, TENANT), eq(opsTasks.id, taskId)))
      .limit(1);
    expect(finalTask[0]?.status).toBe("completed");
  }, 20000);
});
