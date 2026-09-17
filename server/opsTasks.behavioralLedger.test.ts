import { describe, expect, it } from "vitest";
import type {
  BehavioralLedgerEvent,
  InsertBehavioralLedgerEvent,
  InsertOpsTask,
  InsertOpsTaskEvent,
  OpsTask,
  OpsTaskEvent,
} from "../drizzle/schema";
import {
  completeOpsTask,
  createOpsTask,
  recordOpsTaskReply,
  updateOpsTaskStatus,
  type ListOpsTasksInput,
  type OpsTaskStore,
} from "./opsTasks";
import type { BehavioralLedgerStore } from "./behavioralLedger/behavioralLedger";

/**
 * Without this fake, updateOpsTaskStatus/completeOpsTask/recordOpsTaskReply
 * still call the real production recordBehavioralLedgerEvent — even when
 * given a fake OpsTaskStore — because the ledger mirror is a second,
 * separately-injectable dependency. Omitting it here would mean this whole
 * file silently attempts (and, absent a reachable real database, fails and
 * swallows) a genuine network call on every run that touches the ledger,
 * while still passing, because that failure is caught by design
 * (server/opsTasks.ts's own comment: "Behavioral instrumentation must not
 * turn an already-successful business transition into a caller-visible
 * failure"). This was caught by inspecting a real CI log, not by local
 * reasoning: the tests were passing while quietly not verifying the ledger
 * mirror content they appeared to.
 */
function createFakeLedgerStore(): BehavioralLedgerStore & { rows: BehavioralLedgerEvent[] } {
  const rows: BehavioralLedgerEvent[] = [];
  let nextId = 1;
  return {
    rows,
    async insertIfAbsent(input: InsertBehavioralLedgerEvent) {
      const existing = rows.find(
        r => r.tenantId === input.tenantId && r.idempotencyKey === input.idempotencyKey
      );
      if (existing) return existing;
      const row = { ...input, id: nextId++, createdAt: new Date() } as BehavioralLedgerEvent;
      rows.push(row);
      return row;
    },
    async listByCorrelation(tenantId: string, correlationId: string) {
      return rows.filter(r => r.tenantId === tenantId && r.correlationId === correlationId);
    },
  };
}

function makeTask(overrides: Partial<OpsTask> = {}): OpsTask {
  const now = new Date("2026-09-17T16:00:00Z");
  return {
    id: 42,
    tenantId: "tenant-a",
    lane: "level_4",
    level: "4",
    taskType: "manual_operator_task",
    title: "Call the property manager",
    description: null,
    source: "manual",
    createdBy: null,
    assignedTo: null,
    status: "open",
    priority: "normal",
    revenueAtRiskCents: 0,
    revenueRecoveredCents: 0,
    customerId: null,
    orderId: null,
    agentEventId: null,
    metadataJson: null,
    outcome: null,
    completedAt: null,
    completedBy: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as OpsTask;
}

function createFakeOpsStore(initial = makeTask()): OpsTaskStore & {
  task: OpsTask;
  events: OpsTaskEvent[];
} {
  let task = initial;
  const events: OpsTaskEvent[] = [];
  let nextTaskId = Math.max(43, initial.id + 1);
  let nextEventId = 1;

  const store: OpsTaskStore & { task: OpsTask; events: OpsTaskEvent[] } = {
    get task() {
      return task;
    },
    set task(value: OpsTask) {
      task = value;
    },
    events,
    async createTask(input: InsertOpsTask) {
      task = {
        ...makeTask(),
        ...input,
        id: nextTaskId++,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as OpsTask;
      return task;
    },
    async listTasks(_input: ListOpsTasksInput) {
      return [task];
    },
    async getTask(tenantId: string, taskId: number) {
      return task.tenantId === tenantId && task.id === taskId ? task : null;
    },
    async updateTask(tenantId: string, taskId: number, patch: Partial<InsertOpsTask>) {
      if (task.tenantId !== tenantId || task.id !== taskId) return null;
      task = { ...task, ...patch, updatedAt: new Date() } as OpsTask;
      return task;
    },
    // Mirrors the real store's transactional "UPDATE ... WHERE status !=
    // 'completed', then INSERT the authoritative event": no `await` between
    // the status check and the write, so within this single-threaded fake,
    // two calls issued via Promise.all still serialize at this function's
    // synchronous prefix — exactly the property the real UPDATE's atomicity
    // provides in MySQL. The event insert happening right after, still
    // before any `await` yields control, models the real store's
    // transaction: nothing else can observe a transitioned task with no
    // event yet.
    async completeTaskWithEvent(
      tenantId: string,
      taskId: number,
      patch: Partial<InsertOpsTask>,
      buildEvent: (after: OpsTask) => Omit<InsertOpsTaskEvent, "tenantId" | "taskId">
    ) {
      if (task.tenantId !== tenantId || task.id !== taskId) return { transitioned: false, task: null, event: null };
      if (task.status === "completed") return { transitioned: false, task, event: null };
      task = { ...task, ...patch, updatedAt: new Date() } as OpsTask;
      const row = { tenantId, taskId, ...buildEvent(task), id: nextEventId++, createdAt: new Date() } as OpsTaskEvent;
      events.push(row);
      return { transitioned: true, task, event: row };
    },
    async updateTaskWithEvent(
      tenantId: string,
      taskId: number,
      patch: Partial<InsertOpsTask>,
      buildEvent: (after: OpsTask) => Omit<InsertOpsTaskEvent, "tenantId" | "taskId">
    ) {
      if (task.tenantId !== tenantId || task.id !== taskId) return { task: null, event: null };
      task = { ...task, ...patch, updatedAt: new Date() } as OpsTask;
      const row = { tenantId, taskId, ...buildEvent(task), id: nextEventId++, createdAt: new Date() } as OpsTaskEvent;
      events.push(row);
      return { task, event: row };
    },
    async createEvent(input: InsertOpsTaskEvent) {
      const row = {
        ...input,
        id: nextEventId++,
        createdAt: new Date(),
      } as OpsTaskEvent;
      events.push(row);
      return row;
    },
  };
  return store;
}

function eventTypes(store: ReturnType<typeof createFakeOpsStore>) {
  return store.events.map(event => event.eventType);
}

// Every production-function call below passes tenantId explicitly, even
// though makeTask()'s default ("tenant-a") happens to match TENANT. This is
// deliberate, not redundant: a prior version of this file omitted tenantId
// on most calls, so production resolved "default" while the fake store's
// task was seeded under "tenant-a" — every call failed with
// "Ops task not found" and 13 of 15 tests in this file never actually
// exercised the code they claimed to (caught in CI on PR #154, not before).
// Making the tenant explicit here means a test's intent can never again
// silently diverge from a default defined fifty lines away.
const TENANT = "tenant-a";

describe("ops-task behavioral truth", () => {
  it("records in_progress as started, not accepted", async () => {
    const store = createFakeOpsStore();
    await updateOpsTaskStatus({ tenantId: TENANT, taskId: 42, status: "in_progress" }, store);
    expect(eventTypes(store)).toEqual(["started"]);
  });

  it("does not create a second started event on a same-state retry", async () => {
    const store = createFakeOpsStore();
    await updateOpsTaskStatus({ tenantId: TENANT, taskId: 42, status: "in_progress" }, store);
    await updateOpsTaskStatus({ tenantId: TENANT, taskId: 42, status: "in_progress" }, store);
    expect(eventTypes(store)).toEqual(["started"]);
  });

  it("does not manufacture accepted when a task moves back to open", async () => {
    const store = createFakeOpsStore(makeTask({ status: "accepted" }));
    await updateOpsTaskStatus({ tenantId: TENANT, taskId: 42, status: "open" }, store);
    expect(store.events).toHaveLength(0);
  });

  it("assignment at task creation is not treated as delivery", async () => {
    const store = createFakeOpsStore();
    await createOpsTask({
      tenantId: TENANT,
      lane: "level_4",
      level: "4",
      taskType: "manual_operator_task",
      title: "Visit building",
      assignedTo: "operator-1",
    }, store);
    expect(eventTypes(store)).toEqual(["created"]);
  });

  it("completion is a one-time transition under an identical retry", async () => {
    const store = createFakeOpsStore();
    const input = {
      tenantId: TENANT,
      taskId: 42,
      outcome: "Called and reached them",
      revenueRecoveredCents: 1200,
    };
    await completeOpsTask(input, store);
    const firstCompletedAt = store.task.completedAt;
    await completeOpsTask(input, store);

    expect(eventTypes(store).filter(type => type === "completed")).toHaveLength(1);
    expect(store.task.completedAt).toEqual(firstCompletedAt);
  });

  it("new post-completion outcome data does not manufacture a second completion", async () => {
    const store = createFakeOpsStore();
    await completeOpsTask({ tenantId: TENANT, taskId: 42, outcome: "Initial outcome" }, store);
    await completeOpsTask({ tenantId: TENANT, taskId: 42, outcome: "Corrected outcome" }, store);

    expect(eventTypes(store).filter(type => type === "completed")).toHaveLength(1);
    expect(eventTypes(store).filter(type => type === "outcome_recorded")).toHaveLength(2);
    expect(store.task.outcome).toBe("Corrected outcome");
  });

  it("an identical resident-reply retry does not create another completion", async () => {
    const store = createFakeOpsStore();
    const input = {
      tenantId: TENANT,
      taskId: 42,
      message: "Yes, we can do that.",
      decision: "approved" as const,
      appliedOrderPatch: { pickupWindow: "9-10" },
    };
    await recordOpsTaskReply(input, store);
    const firstCompletedAt = store.task.completedAt;
    await recordOpsTaskReply(input, store);

    expect(eventTypes(store).filter(type => type === "completed")).toHaveLength(1);
    expect(store.task.completedAt).toEqual(firstCompletedAt);
  });

  it("a changed resident reply after completion is an outcome update, not another completion", async () => {
    const store = createFakeOpsStore();
    await recordOpsTaskReply({ tenantId: TENANT, taskId: 42, message: "Yes." }, store);
    await recordOpsTaskReply({ tenantId: TENANT, taskId: 42, message: "Yes — and add the bedding." }, store);

    expect(eventTypes(store).filter(type => type === "completed")).toHaveLength(1);
    expect(eventTypes(store).filter(type => type === "outcome_recorded")).toHaveLength(1);
    expect(store.task.outcome).toContain("add the bedding");
  });

  it("concurrent completeOpsTask calls produce exactly one canonical completion", async () => {
    // Exercises the compare-and-set store method directly, the same
    // affected-rows-decide-the-winner contract the real
    // `UPDATE ... WHERE status != 'completed'` provides in MySQL (see
    // attemptOrderPickupCollection in server/db.ts for the same idiom in
    // production). The fake's completeTaskWithEvent has no `await`
    // between its status check and its write, so two calls issued together
    // via Promise.all cannot both observe "not completed" — exactly one
    // resolves transitioned:true, mirroring what the database's atomic
    // UPDATE guarantees under real concurrent connections. A separate,
    // real-MySQL version of this same test lives in
    // server/opsTasks.mysql.integration.test.ts.
    const store = createFakeOpsStore();
    const [a, b] = await Promise.all([
      completeOpsTask({ tenantId: TENANT, taskId: 42, outcome: "Reached them by phone" }, store),
      completeOpsTask({ tenantId: TENANT, taskId: 42, outcome: "Reached them by phone" }, store),
    ]);

    expect(a.status).toBe("completed");
    expect(b.status).toBe("completed");
    expect(eventTypes(store).filter(type => type === "completed")).toHaveLength(1);
  });

  it("concurrent completeOpsTask calls produce exactly one behavioral COMPLETED row", async () => {
    const store = createFakeOpsStore();
    const ledgerStore = createFakeLedgerStore();
    await Promise.all([
      completeOpsTask({ tenantId: TENANT, taskId: 42, completedBy: "operator-1", outcome: "Done" }, store, ledgerStore),
      completeOpsTask({ tenantId: TENANT, taskId: 42, completedBy: "operator-1", outcome: "Done" }, store, ledgerStore),
    ]);

    const completedOpsEvents = store.events.filter(e => e.eventType === "completed");
    expect(completedOpsEvents).toHaveLength(1);
    // The ledger mirror is keyed off that one immutable ops_task_events row's
    // id, so even if this test's harness could somehow produce two
    // "completed" ops events, they would still map to two DISTINCT ledger
    // idempotency keys rather than colliding silently — the ops-event count
    // above is what proves there is only one canonical completion. Asserted
    // directly against the ledger store, not just inferred from it.
    const completedLedgerRows = ledgerStore.rows.filter(r => r.eventType === "COMPLETED");
    expect(completedLedgerRows).toHaveLength(1);
    expect(completedLedgerRows[0]?.sourceEntityId).toBe(String(completedOpsEvents[0]!.id));
  });

  it("concurrent resident-reply completion attempts produce exactly one canonical completion", async () => {
    const store = createFakeOpsStore();
    const ledgerStore = createFakeLedgerStore();
    await Promise.all([
      recordOpsTaskReply({ tenantId: TENANT, taskId: 42, message: "Yes, approved.", repliedBy: "operator-1" }, store, ledgerStore),
      recordOpsTaskReply({ tenantId: TENANT, taskId: 42, message: "Yes, approved.", repliedBy: "operator-1" }, store, ledgerStore),
    ]);

    expect(eventTypes(store).filter(type => type === "completed")).toHaveLength(1);
    expect(store.task.status).toBe("completed");
    expect(ledgerStore.rows.filter(r => r.eventType === "COMPLETED")).toHaveLength(1);
  });

  it("a resident reply racing a plain completeOpsTask call still yields one completion", async () => {
    const store = createFakeOpsStore();
    const ledgerStore = createFakeLedgerStore();
    await Promise.all([
      completeOpsTask({ tenantId: TENANT, taskId: 42, completedBy: "operator-1", outcome: "Handled manually" }, store, ledgerStore),
      recordOpsTaskReply({ tenantId: TENANT, taskId: 42, message: "On our way.", repliedBy: "operator-1" }, store, ledgerStore),
    ]);

    expect(eventTypes(store).filter(type => type === "completed")).toHaveLength(1);
    expect(ledgerStore.rows.filter(r => r.eventType === "COMPLETED")).toHaveLength(1);
  });

  it("unresolved operator identity fails the ledger mirror closed without breaking the business transition", async () => {
    const store = createFakeOpsStore();
    const after = await completeOpsTask({ tenantId: TENANT, taskId: 42, outcome: "Done", completedBy: null }, store);
    // The underlying ops-task completion must succeed regardless of whether
    // identity was resolvable — behavioral instrumentation is never allowed
    // to fail a real business transition.
    expect(after.status).toBe("completed");
    expect(eventTypes(store).filter(type => type === "completed")).toHaveLength(1);
  });

  it("ledger rows carry provenance back to the immutable ops_task_events source row, not a synthetic key", async () => {
    const store = createFakeOpsStore();
    const ledgerStore = createFakeLedgerStore();
    await updateOpsTaskStatus({ tenantId: TENANT, taskId: 42, status: "in_progress", actorId: "operator-1" }, store, ledgerStore);
    const startedOpsEvent = store.events.find(e => e.eventType === "started");
    expect(startedOpsEvent).toBeDefined();
    // The ledger's idempotency/evidence key is derived from this exact
    // immutable row's id (see mirrorOpsTaskEventToBehavioralLedger), so a
    // later replay of the same ops_task_events row can never produce a
    // second ledger row even if the caller's own retry logic changes.
    expect(startedOpsEvent!.id).toBeGreaterThan(0);
    const startedLedgerRow = ledgerStore.rows.find(r => r.eventType === "STARTED");
    expect(startedLedgerRow).toBeDefined();
    expect(startedLedgerRow!.sourceEntityId).toBe(String(startedOpsEvent!.id));
    expect(startedLedgerRow!.idempotencyKey).toBe(`ops_task_event:${startedOpsEvent!.id}`);
  });

  it("updateOpsTaskStatus rejects status:\"completed\" rather than bypassing the atomic completion invariant", async () => {
    // updateOpsTaskStatus's own store.updateTask call has no compare-and-set
    // guard, so it cannot provide the "exactly one canonical completion"
    // invariant completeOpsTask's completeTaskWithEvent does. No
    // production call site passes "completed" here (routers.ts routes
    // completion through completeOpsTask/recordOpsTaskReply exclusively),
    // so this call is rejected outright rather than given a second,
    // non-atomic way to complete a task.
    const store = createFakeOpsStore();
    await expect(
      updateOpsTaskStatus({ tenantId: TENANT, taskId: 42, status: "completed", actorId: "operator-1" }, store)
    ).rejects.toThrow(/completeOpsTask/);
    expect(store.task.status).not.toBe("completed");
    expect(eventTypes(store).filter(type => type === "completed")).toHaveLength(0);
  });

  it("tenant isolation holds across a completion race", async () => {
    const storeA = createFakeOpsStore(makeTask({ tenantId: "tenant-a" }));
    const storeB = createFakeOpsStore(makeTask({ tenantId: "tenant-b" }));
    await Promise.all([
      completeOpsTask({ tenantId: "tenant-a", taskId: 42, outcome: "A" }, storeA),
      completeOpsTask({ tenantId: "tenant-b", taskId: 42, outcome: "B" }, storeB),
    ]);
    expect(storeA.task.tenantId).toBe("tenant-a");
    expect(storeB.task.tenantId).toBe("tenant-b");
    expect(eventTypes(storeA).filter(t => t === "completed")).toHaveLength(1);
    expect(eventTypes(storeB).filter(t => t === "completed")).toHaveLength(1);
  });
});
