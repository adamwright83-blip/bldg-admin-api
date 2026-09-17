import { describe, expect, it } from "vitest";
import type {
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

describe("ops-task behavioral truth", () => {
  it("records in_progress as started, not accepted", async () => {
    const store = createFakeOpsStore();
    await updateOpsTaskStatus({ taskId: 42, status: "in_progress" }, store);
    expect(eventTypes(store)).toEqual(["started"]);
  });

  it("does not create a second started event on a same-state retry", async () => {
    const store = createFakeOpsStore();
    await updateOpsTaskStatus({ taskId: 42, status: "in_progress" }, store);
    await updateOpsTaskStatus({ taskId: 42, status: "in_progress" }, store);
    expect(eventTypes(store)).toEqual(["started"]);
  });

  it("does not manufacture accepted when a task moves back to open", async () => {
    const store = createFakeOpsStore(makeTask({ status: "accepted" }));
    await updateOpsTaskStatus({ taskId: 42, status: "open" }, store);
    expect(store.events).toHaveLength(0);
  });

  it("assignment at task creation is not treated as delivery", async () => {
    const store = createFakeOpsStore();
    await createOpsTask({
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
    await completeOpsTask({ taskId: 42, outcome: "Initial outcome" }, store);
    await completeOpsTask({ taskId: 42, outcome: "Corrected outcome" }, store);

    expect(eventTypes(store).filter(type => type === "completed")).toHaveLength(1);
    expect(eventTypes(store).filter(type => type === "outcome_recorded")).toHaveLength(2);
    expect(store.task.outcome).toBe("Corrected outcome");
  });

  it("an identical resident-reply retry does not create another completion", async () => {
    const store = createFakeOpsStore();
    const input = {
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
    await recordOpsTaskReply({ taskId: 42, message: "Yes." }, store);
    await recordOpsTaskReply({ taskId: 42, message: "Yes — and add the bedding." }, store);

    expect(eventTypes(store).filter(type => type === "completed")).toHaveLength(1);
    expect(eventTypes(store).filter(type => type === "outcome_recorded")).toHaveLength(1);
    expect(store.task.outcome).toContain("add the bedding");
  });
});
