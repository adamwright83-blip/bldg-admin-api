import { describe, expect, it } from "vitest";
import type { InsertOpsTask, InsertOpsTaskEvent, OpsTask, OpsTaskEvent } from "../drizzle/schema";
import {
  buildPerformanceMetricsFromTasks,
  buildWeeklyOperatorReflectionFromTasks,
  completeOpsTask,
  createOpsTask,
  getPerformanceMetrics,
  getWeeklyOperatorReflection,
  listOpsTasks,
  mapLegacyLevelToOps,
  type ListOpsTasksInput,
  type OpsTaskStore,
} from "./opsTasks";

class MemoryOpsTaskStore implements OpsTaskStore {
  tasks: OpsTask[] = [];
  events: OpsTaskEvent[] = [];
  taskId = 1;
  eventId = 1;

  async createTask(input: InsertOpsTask): Promise<OpsTask> {
    const now = new Date();
    const task = {
      id: this.taskId++,
      tenantId: input.tenantId ?? "default",
      lane: input.lane,
      level: input.level,
      taskType: input.taskType,
      title: input.title,
      description: input.description ?? null,
      source: input.source ?? "manual",
      createdBy: input.createdBy ?? null,
      assignedTo: input.assignedTo ?? null,
      status: input.status ?? "open",
      priority: input.priority ?? "normal",
      revenueAtRiskCents: input.revenueAtRiskCents ?? 0,
      revenueRecoveredCents: input.revenueRecoveredCents ?? 0,
      customerId: input.customerId ?? null,
      orderId: input.orderId ?? null,
      agentEventId: input.agentEventId ?? null,
      metadataJson: input.metadataJson ?? null,
      outcome: input.outcome ?? null,
      createdAt: now,
      updatedAt: now,
      completedAt: input.completedAt ?? null,
      completedBy: input.completedBy ?? null,
    } satisfies OpsTask;
    this.tasks.push(task);
    return task;
  }

  async listTasks(input: ListOpsTasksInput): Promise<OpsTask[]> {
    return this.tasks.filter((task) => {
      if (input.tenantId && task.tenantId !== input.tenantId) return false;
      if (input.status) {
        const statuses = Array.isArray(input.status) ? input.status : [input.status];
        if (!statuses.includes(task.status)) return false;
      }
      if (input.lane && task.lane !== input.lane) return false;
      if (input.level && task.level !== input.level) return false;
      if (input.dateFrom && task.createdAt < input.dateFrom) return false;
      if (input.dateTo && task.createdAt >= input.dateTo) return false;
      return true;
    }).slice(0, input.limit ?? 200);
  }

  async getTask(tenantId: string, taskId: number): Promise<OpsTask | null> {
    return this.tasks.find((task) => task.tenantId === tenantId && task.id === taskId) ?? null;
  }

  async updateTask(tenantId: string, taskId: number, patch: Partial<InsertOpsTask>): Promise<OpsTask | null> {
    const task = await this.getTask(tenantId, taskId);
    if (!task) return null;
    Object.assign(task, patch, { updatedAt: new Date() });
    return task;
  }

  async createEvent(input: InsertOpsTaskEvent): Promise<OpsTaskEvent> {
    const event = {
      id: this.eventId++,
      tenantId: input.tenantId ?? "default",
      taskId: input.taskId,
      eventType: input.eventType,
      actorType: input.actorType ?? "human",
      actorId: input.actorId ?? null,
      agentEventId: input.agentEventId ?? null,
      beforeJson: input.beforeJson ?? null,
      afterJson: input.afterJson ?? null,
      note: input.note ?? null,
      createdAt: new Date(),
    } satisfies OpsTaskEvent;
    this.events.push(event);
    return event;
  }
}

async function completedTask(store: MemoryOpsTaskStore, overrides: Partial<Parameters<typeof createOpsTask>[0]> = {}) {
  const task = await createOpsTask({
    tenantId: "default",
    lane: "lane_3",
    level: "3",
    taskType: "unpaid_order",
    title: "Collect unpaid order",
    source: "system_detected",
    revenueAtRiskCents: 8600,
    ...overrides,
  }, store);
  return completeOpsTask({
    tenantId: "default",
    taskId: task.id,
    revenueRecoveredCents: 8600,
    outcome: "Paid in full",
    completedBy: "tester",
  }, store);
}

describe("ops task proof layer", () => {
  it("creates an ops task", async () => {
    const store = new MemoryOpsTaskStore();
    const task = await createOpsTask({
      tenantId: "default",
      lane: "lane_1",
      level: "1",
      taskType: "vague_intake",
      title: "Price unclear dry-clean intake",
    }, store);
    expect(task.id).toBe(1);
    expect(task.status).toBe("open");
    expect(store.events[0].eventType).toBe("created");
  });

  it("completes an ops task", async () => {
    const store = new MemoryOpsTaskStore();
    const task = await createOpsTask({ lane: "lane_2", level: "2", taskType: "vendor_followup", title: "Call vendor" }, store);
    const completed = await completeOpsTask({ taskId: task.id, outcome: "Vendor confirmed", completedBy: "adam" }, store);
    expect(completed.status).toBe("completed");
    expect(completed.completedBy).toBe("adam");
    expect(completed.outcome).toBe("Vendor confirmed");
  });

  it("creates a completed event when completing", async () => {
    const store = new MemoryOpsTaskStore();
    const task = await createOpsTask({ lane: "lane_2", level: "2", taskType: "gm_followup", title: "GM follow-up" }, store);
    await completeOpsTask({ taskId: task.id }, store);
    expect(store.events.some((event) => event.eventType === "completed" && event.taskId === task.id)).toBe(true);
  });

  it("persists revenueRecoveredCents", async () => {
    const store = new MemoryOpsTaskStore();
    const done = await completedTask(store);
    expect(done.revenueRecoveredCents).toBe(8600);
    expect(store.events.some((event) => event.eventType === "revenue_recovered")).toBe(true);
  });

  it("weeklyReflection returns correct totals", async () => {
    const store = new MemoryOpsTaskStore();
    await completedTask(store);
    await createOpsTask({ lane: "lane_1", level: "1", taskType: "vague_intake", title: "Needs pricing" }, store);
    const reflection = buildWeeklyOperatorReflectionFromTasks(await listOpsTasks({ tenantId: "default" }, store));
    expect(reflection.metrics.thingsFinished).toBe(1);
    expect(reflection.metrics.revenueProtectedCents).toBe(8600);
    expect(reflection.attention).toHaveLength(1);
  });

  it("performanceMetrics returns correct totals", async () => {
    const store = new MemoryOpsTaskStore();
    await completedTask(store);
    await createOpsTask({ lane: "lane_3", level: "3", taskType: "revenue_leak", title: "Open leak", revenueAtRiskCents: 1200 }, store);
    const metrics = buildPerformanceMetricsFromTasks(await listOpsTasks({ tenantId: "default" }, store));
    expect(metrics.totalTasksCompleted).toBe(1);
    expect(metrics.revenueRecoveredCents).toBe(8600);
    expect(metrics.unresolvedRevenueLeaks).toBe(1);
  });

  it("excludes dismissed tasks from completed totals", async () => {
    const store = new MemoryOpsTaskStore();
    await createOpsTask({ lane: "lane_3", level: "3", taskType: "revenue_leak", title: "Dismissed leak", status: "dismissed" }, store);
    const metrics = buildPerformanceMetricsFromTasks(await listOpsTasks({ tenantId: "default" }, store));
    expect(metrics.totalTasksCompleted).toBe(0);
  });

  it("logs Level 4 tasks as lane level_4", async () => {
    const store = new MemoryOpsTaskStore();
    const task = await createOpsTask({ lane: "level_4", level: "4", taskType: "referral_ask", title: "Ask for referral" }, store);
    expect(task.lane).toBe("level_4");
    expect(task.level).toBe("4");
  });

  it("links agentEventId", async () => {
    const store = new MemoryOpsTaskStore();
    const task = await createOpsTask({
      lane: "lane_1",
      level: "1",
      taskType: "intake_missing_price",
      title: "Agent found missing price",
      source: "agent_suggested",
      agentEventId: 44,
    }, store);
    expect(task.agentEventId).toBe(44);
    expect(store.events[0].eventType).toBe("agent_suggested");
    expect(store.events[0].agentEventId).toBe(44);
  });

  it("maps level_1 safely to lane and level DB values", () => {
    expect(mapLegacyLevelToOps("level_1")).toEqual({ lane: "lane_1", level: "1" });
    expect(mapLegacyLevelToOps("level_4")).toEqual({ lane: "level_4", level: "4" });
  });

  it("does not synthesize fake sample data in production metric helpers", async () => {
    const store = new MemoryOpsTaskStore();
    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect((await getWeeklyOperatorReflection("default", store)).metrics.thingsFinished).toBe(0);
      expect((await getPerformanceMetrics("default", store)).totalTasksCompleted).toBe(0);
    } finally {
      process.env.NODE_ENV = oldEnv;
    }
  });
});
