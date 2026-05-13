import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  opsTaskEvents,
  opsTasks,
  type InsertOpsTask,
  type InsertOpsTaskEvent,
  type OpsTask,
  type OpsTaskEvent,
} from "../drizzle/schema";
import { getDb } from "./db";
import { getDashboardTimeZone, zonedWeekRangeUtcContaining } from "./dashboardZoned";

export const OPS_TASK_LANES = ["lane_1", "lane_2", "lane_3", "level_4"] as const;
export const OPS_TASK_LEVELS = ["1", "2", "3", "4"] as const;
export const OPS_TASK_STATUSES = ["open", "accepted", "in_progress", "completed", "dismissed", "expired"] as const;
export const OPS_TASK_TYPES = [
  "intake_missing_price",
  "unpaid_order",
  "vague_intake",
  "missed_pickup",
  "stale_customer",
  "revenue_leak",
  "referral_ask",
  "vendor_followup",
  "gm_followup",
  "manual_operator_task",
  "dry_clean_receipt_intake",
  "emergency_task",
] as const;
export const OPS_TASK_SOURCES = ["manual", "agent_suggested", "system_detected", "level_4", "voice", "quick_input", "emergency_composer"] as const;
export const OPS_TASK_EVENT_TYPES = [
  "created",
  "viewed",
  "accepted",
  "completed",
  "dismissed",
  "expired",
  "agent_suggested",
  "human_approved",
  "revenue_recovered",
  "outcome_recorded",
] as const;

export type OpsTaskLane = (typeof OPS_TASK_LANES)[number];
export type OpsTaskLevel = (typeof OPS_TASK_LEVELS)[number];
export type OpsTaskStatus = (typeof OPS_TASK_STATUSES)[number];
export type OpsTaskType = (typeof OPS_TASK_TYPES)[number];
export type OpsTaskSource = (typeof OPS_TASK_SOURCES)[number];
export type OpsTaskEventType = (typeof OPS_TASK_EVENT_TYPES)[number];

export type CreateOpsTaskInput = {
  tenantId?: string;
  lane: OpsTaskLane;
  level: OpsTaskLevel;
  taskType: OpsTaskType;
  title: string;
  description?: string | null;
  source?: OpsTaskSource;
  createdBy?: string | null;
  assignedTo?: string | null;
  status?: OpsTaskStatus;
  priority?: "low" | "normal" | "high" | "emergency";
  revenueAtRiskCents?: number;
  revenueRecoveredCents?: number;
  customerId?: number | null;
  orderId?: number | null;
  agentEventId?: number | null;
  metadataJson?: unknown;
  outcome?: string | null;
};

export type ListOpsTasksInput = {
  tenantId?: string;
  status?: OpsTaskStatus | OpsTaskStatus[];
  lane?: OpsTaskLane;
  level?: OpsTaskLevel;
  dateFrom?: Date | null;
  dateTo?: Date | null;
  limit?: number;
};

export type CreateOpsTaskEventInput = {
  tenantId?: string;
  taskId: number;
  eventType: OpsTaskEventType;
  actorType?: InsertOpsTaskEvent["actorType"];
  actorId?: string | null;
  agentEventId?: number | null;
  beforeJson?: unknown;
  afterJson?: unknown;
  note?: string | null;
};

export type OpsTaskStore = {
  createTask(input: InsertOpsTask): Promise<OpsTask>;
  listTasks(input: ListOpsTasksInput): Promise<OpsTask[]>;
  getTask(tenantId: string, taskId: number): Promise<OpsTask | null>;
  updateTask(tenantId: string, taskId: number, patch: Partial<InsertOpsTask>): Promise<OpsTask | null>;
  createEvent(input: InsertOpsTaskEvent): Promise<OpsTaskEvent>;
};

function assertTaskTitle(title: string) {
  const clean = title.trim();
  if (!clean) throw new Error("Ops task title is required");
  return clean.slice(0, 255);
}

function laneForLevel(level: OpsTaskLevel): OpsTaskLane {
  if (level === "4") return "level_4";
  return `lane_${level}` as OpsTaskLane;
}

export function mapLegacyLevelToOps(level: "level_1" | "level_2" | "level_3" | "level_4") {
  const nextLevel = level === "level_4" ? "4" : level.replace("level_", "") as OpsTaskLevel;
  return { lane: laneForLevel(nextLevel), level: nextLevel };
}

const drizzleOpsTaskStore: OpsTaskStore = {
  async createTask(input) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const result = await db.insert(opsTasks).values(input);
    const id = Number(result[0].insertId);
    const rows = await db.select().from(opsTasks).where(eq(opsTasks.id, id)).limit(1);
    if (!rows[0]) throw new Error("Ops task insert did not return a row");
    return rows[0];
  },
  async listTasks(input) {
    const db = await getDb();
    if (!db) return [];
    const tenantId = input.tenantId ?? "default";
    const clauses = [eq(opsTasks.tenantId, tenantId)];
    if (input.status) {
      clauses.push(Array.isArray(input.status) ? inArray(opsTasks.status, input.status) : eq(opsTasks.status, input.status));
    }
    if (input.lane) clauses.push(eq(opsTasks.lane, input.lane));
    if (input.level) clauses.push(eq(opsTasks.level, input.level));
    if (input.dateFrom) clauses.push(gte(opsTasks.createdAt, input.dateFrom));
    if (input.dateTo) clauses.push(lt(opsTasks.createdAt, input.dateTo));
    return db
      .select()
      .from(opsTasks)
      .where(and(...clauses))
      .orderBy(desc(opsTasks.createdAt), desc(opsTasks.id))
      .limit(Math.min(Math.max(input.limit ?? 200, 1), 500));
  },
  async getTask(tenantId, taskId) {
    const db = await getDb();
    if (!db) return null;
    const rows = await db
      .select()
      .from(opsTasks)
      .where(and(eq(opsTasks.tenantId, tenantId), eq(opsTasks.id, taskId)))
      .limit(1);
    return rows[0] ?? null;
  },
  async updateTask(tenantId, taskId, patch) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    await db
      .update(opsTasks)
      .set(patch)
      .where(and(eq(opsTasks.tenantId, tenantId), eq(opsTasks.id, taskId)));
    const rows = await db
      .select()
      .from(opsTasks)
      .where(and(eq(opsTasks.tenantId, tenantId), eq(opsTasks.id, taskId)))
      .limit(1);
    return rows[0] ?? null;
  },
  async createEvent(input) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const result = await db.insert(opsTaskEvents).values(input);
    const id = Number(result[0].insertId);
    const rows = await db.select().from(opsTaskEvents).where(eq(opsTaskEvents.id, id)).limit(1);
    if (!rows[0]) throw new Error("Ops task event insert did not return a row");
    return rows[0];
  },
};

export async function createOpsTask(input: CreateOpsTaskInput, store: OpsTaskStore = drizzleOpsTaskStore): Promise<OpsTask> {
  const tenantId = input.tenantId ?? "default";
  const task = await store.createTask({
    tenantId,
    lane: input.lane,
    level: input.level,
    taskType: input.taskType,
    title: assertTaskTitle(input.title),
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
  });

  await store.createEvent({
    tenantId,
    taskId: task.id,
    eventType: input.source === "agent_suggested" ? "agent_suggested" : "created",
    actorType: input.source === "agent_suggested" ? "ai_agent" : "human",
    actorId: input.createdBy ?? null,
    agentEventId: input.agentEventId ?? null,
    beforeJson: null,
    afterJson: task,
    note: null,
  });
  return task;
}

export async function createOpsTaskEvent(
  input: CreateOpsTaskEventInput,
  store: OpsTaskStore = drizzleOpsTaskStore
): Promise<OpsTaskEvent> {
  return store.createEvent({
    tenantId: input.tenantId ?? "default",
    taskId: input.taskId,
    eventType: input.eventType,
    actorType: input.actorType ?? "human",
    actorId: input.actorId ?? null,
    agentEventId: input.agentEventId ?? null,
    beforeJson: input.beforeJson ?? null,
    afterJson: input.afterJson ?? null,
    note: input.note ?? null,
  });
}

export async function listOpsTasks(input: ListOpsTasksInput = {}, store: OpsTaskStore = drizzleOpsTaskStore): Promise<OpsTask[]> {
  return store.listTasks(input);
}

export async function updateOpsTaskStatus(
  input: { tenantId?: string; taskId: number; status: OpsTaskStatus; actorId?: string | null; note?: string | null },
  store: OpsTaskStore = drizzleOpsTaskStore
): Promise<OpsTask> {
  const tenantId = input.tenantId ?? "default";
  const before = await store.getTask(tenantId, input.taskId);
  if (!before) throw new Error("Ops task not found");
  const patch: Partial<InsertOpsTask> = { status: input.status };
  const after = await store.updateTask(tenantId, input.taskId, patch);
  if (!after) throw new Error("Ops task update failed");
  const eventType = input.status === "dismissed" ? "dismissed" : input.status === "expired" ? "expired" : input.status === "completed" ? "completed" : "accepted";
  await createOpsTaskEvent({
    tenantId,
    taskId: input.taskId,
    eventType,
    actorId: input.actorId ?? null,
    beforeJson: before,
    afterJson: after,
    note: input.note ?? null,
  }, store);
  return after;
}

export async function completeOpsTask(
  input: {
    tenantId?: string;
    taskId: number;
    outcome?: string | null;
    revenueRecoveredCents?: number;
    completedBy?: string | null;
  },
  store: OpsTaskStore = drizzleOpsTaskStore
): Promise<OpsTask> {
  const tenantId = input.tenantId ?? "default";
  const before = await store.getTask(tenantId, input.taskId);
  if (!before) throw new Error("Ops task not found");
  const completedAt = new Date();
  const patch: Partial<InsertOpsTask> = {
    status: "completed",
    completedAt,
    completedBy: input.completedBy ?? null,
    outcome: input.outcome ?? before.outcome ?? null,
  };
  if (input.revenueRecoveredCents !== undefined) {
    patch.revenueRecoveredCents = input.revenueRecoveredCents;
  }
  const after = await store.updateTask(tenantId, input.taskId, patch);
  if (!after) throw new Error("Ops task completion failed");

  await createOpsTaskEvent({
    tenantId,
    taskId: input.taskId,
    eventType: "completed",
    actorId: input.completedBy ?? null,
    beforeJson: before,
    afterJson: after,
    note: input.outcome ?? null,
    agentEventId: after.agentEventId ?? null,
  }, store);
  if ((input.revenueRecoveredCents ?? 0) > 0) {
    await createOpsTaskEvent({
      tenantId,
      taskId: input.taskId,
      eventType: "revenue_recovered",
      actorId: input.completedBy ?? null,
      afterJson: { revenueRecoveredCents: input.revenueRecoveredCents },
      agentEventId: after.agentEventId ?? null,
    }, store);
  }
  if (input.outcome) {
    await createOpsTaskEvent({
      tenantId,
      taskId: input.taskId,
      eventType: "outcome_recorded",
      actorId: input.completedBy ?? null,
      afterJson: { outcome: input.outcome },
      agentEventId: after.agentEventId ?? null,
      note: input.outcome,
    }, store);
  }
  if (after.lane === "lane_1" || after.lane === "lane_2" || after.lane === "lane_3") {
    try {
      const { evaluateLevel4MissionUnlock } = await import("./level4Missions");
      await evaluateLevel4MissionUnlock({
        tenantId,
        operatorId: after.completedBy,
        taskStore: store,
      });
    } catch (error) {
      console.warn("[Level4Mission] Failed to evaluate unlock after task completion:", error);
    }
  }
  return after;
}

function averageCompletionMinutes(tasks: OpsTask[]) {
  const durations = tasks
    .filter((task) => task.completedAt)
    .map((task) => Math.max(0, (new Date(task.completedAt!).getTime() - new Date(task.createdAt).getTime()) / 60000));
  if (durations.length === 0) return null;
  return Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length);
}

function laneLabel(lane: OpsTaskLane) {
  if (lane === "lane_1") return "Lane 1 — Intake & Onboarding";
  if (lane === "lane_2") return "Lane 2 — Status & Follow Ups";
  if (lane === "lane_3") return "Lane 3 — Collections & Revenue";
  return "Level 4 — High Value / Growth";
}

function isReengagement(task: OpsTask) {
  return task.taskType === "stale_customer" || task.taskType === "referral_ask" || /reactivat|re-engag|reengag|follow/i.test(task.outcome ?? task.title);
}

function buildBreakthroughs(completed: OpsTask[], now: Date) {
  const items: Array<{ title: string; detail: string }> = [];
  const oldLoop = completed.find((task) => now.getTime() - new Date(task.createdAt).getTime() >= 7 * 24 * 60 * 60 * 1000);
  if (oldLoop) {
    items.push({
      title: "You closed an old open loop.",
      detail: `${oldLoop.title} was completed after more than a week open.`,
    });
  }
  const collections = completed.find((task) => task.lane === "lane_3" || task.taskType === "unpaid_order" || task.taskType === "revenue_leak");
  if (collections) {
    items.push({
      title: "You protected revenue from leaking.",
      detail: `${collections.title}${collections.revenueRecoveredCents ? ` recovered ${(collections.revenueRecoveredCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}.` : "."}`,
    });
  }
  const immediate = completed.find((task) => task.taskType === "dry_clean_receipt_intake" || /receipt|charge/i.test(task.title));
  if (immediate) {
    items.push({
      title: "You captured the fragile handoff.",
      detail: `${immediate.title} became structured data instead of an end-of-day memory task.`,
    });
  }
  const reengaged = completed.find(isReengagement);
  if (reengaged) {
    items.push({
      title: "You restarted a customer thread.",
      detail: `${reengaged.title} moved a relationship forward.`,
    });
  }
  return items.slice(0, 3);
}

export function buildWeeklyOperatorReflectionFromTasks(tasks: OpsTask[], now = new Date()) {
  const completed = tasks
    .filter((task) => task.status === "completed" && task.completedAt)
    .sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime());
  const open = tasks
    .filter((task) => ["open", "accepted", "in_progress"].includes(task.status))
    .sort((a, b) => (b.revenueAtRiskCents - a.revenueAtRiskCents) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const laneBreakdown = OPS_TASK_LANES.map((lane) => {
    const laneTasks = tasks.filter((task) => task.lane === lane);
    const laneCompleted = completed.filter((task) => task.lane === lane);
    return {
      lane,
      label: laneLabel(lane),
      completedCount: laneCompleted.length,
      averageCompletionMinutes: averageCompletionMinutes(laneCompleted),
      unresolvedCount: laneTasks.filter((task) => ["open", "accepted", "in_progress"].includes(task.status)).length,
      recentCompletedExample: laneCompleted[0] ?? null,
    };
  });

  return {
    range: null as null | { start: string; end: string },
    metrics: {
      thingsFinished: completed.length,
      revenueProtectedCents: completed.reduce((sum, task) => sum + (task.revenueRecoveredCents || 0), 0),
      customersReengaged: completed.filter(isReengagement).length,
      patternsBroken: buildBreakthroughs(completed, now).length,
    },
    laneBreakdown,
    breakthroughs: buildBreakthroughs(completed, now),
    recentlyCompleted: completed.slice(0, 10),
    attention: open.slice(0, 3),
    empty: completed.length === 0,
  };
}

export function buildPerformanceMetricsFromTasks(tasks: OpsTask[]) {
  const completed = tasks.filter((task) => task.status === "completed");
  const active = tasks.filter((task) => ["open", "accepted", "in_progress"].includes(task.status));
  return {
    totalTasksCompleted: completed.length,
    revenueRecoveredCents: completed.reduce((sum, task) => sum + (task.revenueRecoveredCents || 0), 0),
    revenueAtRiskDetectedCents: tasks.reduce((sum, task) => sum + (task.revenueAtRiskCents || 0), 0),
    averageCompletionMinutes: averageCompletionMinutes(completed),
    staleCustomersReactivated: completed.filter((task) => task.taskType === "stale_customer").length,
    level4ActionsCompleted: completed.filter((task) => task.lane === "level_4").length,
    referralAsksCompleted: completed.filter((task) => task.taskType === "referral_ask").length,
    unresolvedRevenueLeaks: active.filter((task) => task.taskType === "revenue_leak" || task.taskType === "unpaid_order").length,
  };
}

function currentWeekRange(now = new Date()) {
  const timezone = getDashboardTimeZone();
  const range = zonedWeekRangeUtcContaining(now, timezone);
  return { startUtc: range.start, endUtc: range.end, timezone };
}

export async function getWeeklyOperatorReflection(tenantId = "default", store: OpsTaskStore = drizzleOpsTaskStore) {
  const range = currentWeekRange();
  const tasks = await listOpsTasks({
    tenantId,
    dateFrom: range.startUtc,
    dateTo: range.endUtc,
    limit: 500,
  }, store);
  const reflection = buildWeeklyOperatorReflectionFromTasks(tasks);
  return {
    ...reflection,
    range: {
      start: range.startUtc.toISOString(),
      end: range.endUtc.toISOString(),
      timezone: range.timezone,
    },
  };
}

export async function getPerformanceMetrics(tenantId = "default", store: OpsTaskStore = drizzleOpsTaskStore) {
  const tasks = await listOpsTasks({ tenantId, limit: 500 }, store);
  return buildPerformanceMetricsFromTasks(tasks);
}

export async function createOpsTaskForAgentSuggestion(input: CreateOpsTaskInput & { agentEventId: number }) {
  return createOpsTask({
    ...input,
    source: "agent_suggested",
    agentEventId: input.agentEventId,
  });
}

export async function createOrCompleteLevel4OpsTask(input: {
  tenantId: string;
  actionType: string;
  title: string;
  description?: string | null;
  customerId?: number | null;
  revenueAtRiskCents?: number;
  metadataJson?: unknown;
  completedBy?: string | null;
}) {
  const taskType: OpsTaskType =
    input.actionType === "referral_request"
      ? "referral_ask"
      : input.actionType === "building_penetration"
        ? "gm_followup"
        : "revenue_leak";
  const task = await createOpsTask({
    tenantId: input.tenantId,
    lane: "level_4",
    level: "4",
    taskType,
    title: input.title,
    description: input.description ?? null,
    source: "level_4",
    priority: "high",
    customerId: input.customerId ?? null,
    revenueAtRiskCents: input.revenueAtRiskCents ?? 0,
    metadataJson: {
      actionType: input.actionType,
      idempotencyKey: nanoid(10),
      ...(typeof input.metadataJson === "object" && input.metadataJson ? input.metadataJson as Record<string, unknown> : {}),
    },
    createdBy: input.completedBy ?? null,
  });
  return completeOpsTask({
    tenantId: input.tenantId,
    taskId: task.id,
    outcome: "Level 4 action completed.",
    completedBy: input.completedBy ?? null,
  });
}
