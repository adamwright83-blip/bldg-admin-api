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
import type { LedgerEventType } from "../shared/behavioralLedger";
import { getDb } from "./db";
import { getDashboardTimeZone, zonedWeekRangeUtcContaining } from "./dashboardZoned";
import { recordBehavioralLedgerEvent, type BehavioralLedgerStore } from "./behavioralLedger/behavioralLedger";

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
  "door_hanger_operation",
  "office_account_pitch",
  "review_request",
  "digital_footprint_post",
  "partnership_outreach",
] as const;
export const OPS_TASK_SOURCES = ["manual", "agent_suggested", "system_detected", "level_4", "voice", "quick_input", "emergency_composer"] as const;
export const OPS_TASK_EVENT_TYPES = [
  "created",
  "viewed",
  "accepted",
  "started",
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
  /**
   * Atomic compare-and-set + authoritative event insert, in one transaction.
   * Writes `patch` only if the row's current status is not already
   * "completed" — `transitioned` is true only for whichever concurrent
   * caller's UPDATE actually changed the row, the same
   * affected-rows-decide-the-winner idiom as `attemptOrderPickupCollection`
   * in server/db.ts. `buildEvent` is called with the post-update row only
   * when `transitioned` is true, and its returned event is inserted in the
   * SAME transaction: if that insert fails, the transaction rolls back the
   * status change too, so a completed task can never end up with no
   * authoritative `ops_task_events.completed` row behind it. The downstream
   * behavioral-ledger mirror is allowed to be best-effort/replayable
   * exactly because this pairing is not.
   */
  completeTaskWithEvent(
    tenantId: string,
    taskId: number,
    patch: Partial<InsertOpsTask>,
    buildEvent: (after: OpsTask) => Omit<InsertOpsTaskEvent, "tenantId" | "taskId">
  ): Promise<{ transitioned: boolean; task: OpsTask | null; event: OpsTaskEvent | null }>;
  /**
   * Non-completion state transition (accepted/started/dismissed/expired) plus
   * its authoritative event, in one transaction — same reasoning as
   * completeTaskWithEvent, minus the CAS guard: these statuses don't carry
   * completion's exactly-once invariant, but a status change with no
   * corresponding event (because the event insert failed after the UPDATE
   * committed) would still corrupt the ledger's source history.
   */
  updateTaskWithEvent(
    tenantId: string,
    taskId: number,
    patch: Partial<InsertOpsTask>,
    buildEvent: (after: OpsTask) => Omit<InsertOpsTaskEvent, "tenantId" | "taskId">
  ): Promise<{ task: OpsTask | null; event: OpsTaskEvent | null }>;
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

function lifecycleTransitionForStatus(
  status: OpsTaskStatus
): { opsEventType: OpsTaskEventType; ledgerEventType: LedgerEventType } | null {
  switch (status) {
    case "accepted":
      return { opsEventType: "accepted", ledgerEventType: "ACCEPTED" };
    case "in_progress":
      return { opsEventType: "started", ledgerEventType: "STARTED" };
    case "completed":
      // Unreachable via updateOpsTaskStatus, which rejects "completed"
      // before calling this function. Kept only so this switch stays
      // exhaustive over OpsTaskStatus; completion has its own atomic path
      // (completeOpsTask / completeTaskWithEvent).
      return { opsEventType: "completed", ledgerEventType: "COMPLETED" };
    case "dismissed":
      return { opsEventType: "dismissed", ledgerEventType: "DISMISSED" };
    case "expired":
      return { opsEventType: "expired", ledgerEventType: "EXPIRED" };
    case "open":
      // There is no truthful existing ops-task event meaning "reopened".
      // Do not lie by recording ACCEPTED merely because open is the fallback.
      return null;
  }
}

async function mirrorOpsTaskEventToBehavioralLedger(input: {
  tenantId: string;
  taskId: number;
  operatorUserId: string | null | undefined;
  sourceEvent: OpsTaskEvent;
  ledgerEventType: LedgerEventType;
  /**
   * Injectable for tests that pass a fake OpsTaskStore: without this, a
   * pure in-memory unit test still reaches the real recordBehavioralLedgerEvent
   * and its real getDb(), attempting (and, in any environment without a
   * reachable DATABASE_URL matching the real schema, failing) a genuine
   * network call on every run — silently, since the catch below is
   * intentionally non-throwing. That's correct production behavior
   * (instrumentation must never fail a business transition) but it means a
   * test using a fake OpsTaskStore was never actually exercising or
   * verifying the ledger mirror, only appearing to. Omit this to get the
   * real production store, exactly as before.
   */
  ledgerStore?: BehavioralLedgerStore;
}) {
  if (!input.operatorUserId) return;
  try {
    await recordBehavioralLedgerEvent({
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      correlationId: `ops_task:${input.taskId}`,
      sourceSystem: "ops_task",
      sourceEntityType: "ops_task_event",
      sourceEntityId: String(input.sourceEvent.id),
      eventType: input.ledgerEventType,
      occurredAt: input.sourceEvent.createdAt,
      verificationClass: input.ledgerEventType === "COMPLETED" ? "CLAIMED" : null,
      provenance: "ops_task_event",
      evidenceSource: `ops_task_event:${input.sourceEvent.id}`,
      idempotencyKey: `ops_task_event:${input.sourceEvent.id}`,
    }, input.ledgerStore);
  } catch (error) {
    // ops_task_events is the authoritative source record and can be replayed.
    // Behavioral instrumentation must not turn an already-successful business
    // transition into a caller-visible failure.
    console.warn("[BehavioralLedger] Failed to mirror ops task event", {
      tenantId: input.tenantId,
      taskId: input.taskId,
      sourceEventId: input.sourceEvent.id,
      ledgerEventType: input.ledgerEventType,
      error,
    });
  }
}

function sameJsonValue(a: unknown, b: unknown) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
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
  async completeTaskWithEvent(tenantId, taskId, patch, buildEvent) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    return db.transaction(async tx => {
      const result = await tx
        .update(opsTasks)
        .set(patch)
        .where(
          and(
            eq(opsTasks.tenantId, tenantId),
            eq(opsTasks.id, taskId),
            sql`${opsTasks.status} != 'completed'`
          )
        );
      const affectedRows = Number(
        (result as unknown as { [0]?: { affectedRows?: number } })[0]?.affectedRows ?? 0
      );
      const rows = await tx
        .select()
        .from(opsTasks)
        .where(and(eq(opsTasks.tenantId, tenantId), eq(opsTasks.id, taskId)))
        .limit(1);
      const task = rows[0] ?? null;
      if (affectedRows === 0 || !task) {
        return { transitioned: false, task, event: null };
      }

      const eventInput = { tenantId, taskId, ...buildEvent(task) } as InsertOpsTaskEvent;
      const insertResult = await tx.insert(opsTaskEvents).values(eventInput);
      const eventId = Number(insertResult[0].insertId);
      const eventRows = await tx
        .select()
        .from(opsTaskEvents)
        .where(eq(opsTaskEvents.id, eventId))
        .limit(1);
      const event = eventRows[0] ?? null;
      // Thrown inside db.transaction(): the status UPDATE above rolls back
      // too. A completed task with no authoritative completion event is
      // exactly the state this method exists to make impossible.
      if (!event) throw new Error("Ops task completion event insert did not return a row");
      return { transitioned: true, task, event };
    });
  },
  async updateTaskWithEvent(tenantId, taskId, patch, buildEvent) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    return db.transaction(async tx => {
      await tx
        .update(opsTasks)
        .set(patch)
        .where(and(eq(opsTasks.tenantId, tenantId), eq(opsTasks.id, taskId)));
      const rows = await tx
        .select()
        .from(opsTasks)
        .where(and(eq(opsTasks.tenantId, tenantId), eq(opsTasks.id, taskId)))
        .limit(1);
      const task = rows[0] ?? null;
      if (!task) return { task: null, event: null };

      const eventInput = { tenantId, taskId, ...buildEvent(task) } as InsertOpsTaskEvent;
      const insertResult = await tx.insert(opsTaskEvents).values(eventInput);
      const eventId = Number(insertResult[0].insertId);
      const eventRows = await tx
        .select()
        .from(opsTaskEvents)
        .where(eq(opsTaskEvents.id, eventId))
        .limit(1);
      const event = eventRows[0] ?? null;
      if (!event) throw new Error("Ops task event insert did not return a row");
      return { task, event };
    });
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

  // Assignment is not delivery. Do not create a DELIVERED behavioral event
  // here; that belongs at the real presentation/send boundary when one exists.
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
  store: OpsTaskStore = drizzleOpsTaskStore,
  ledgerStore?: BehavioralLedgerStore
): Promise<OpsTask> {
  // "completed" has its own atomic invariant (completeTaskWithEvent):
  // exactly one caller may author the canonical completion, and a plain
  // status-comparison-then-updateTask (below) cannot provide that under
  // concurrent requests. No production call site currently passes
  // "completed" here — routers.ts routes completion through
  // completeOpsTask()/recordOpsTaskReply() exclusively — so this closes the
  // hole by construction rather than trusting every future caller to
  // remember which function to use.
  if (input.status === "completed") {
    throw new Error(
      "updateOpsTaskStatus does not support status:\"completed\" — use completeOpsTask() so the completion transition stays atomic."
    );
  }

  const tenantId = input.tenantId ?? "default";
  const before = await store.getTask(tenantId, input.taskId);
  if (!before) throw new Error("Ops task not found");

  // A same-state retry is not a new behavioral act.
  if (before.status === input.status) return before;

  const patch: Partial<InsertOpsTask> = { status: input.status };
  const transition = lifecycleTransitionForStatus(input.status);

  if (!transition) {
    // "open" (reopen): no truthful event exists for this, so no event to
    // pair atomically with the state change — a plain update is correct.
    const after = await store.updateTask(tenantId, input.taskId, patch);
    if (!after) throw new Error("Ops task update failed");
    return after;
  }

  // State change + its authoritative event, in one transaction: a status
  // change with no corresponding event (because the event insert failed
  // after the UPDATE committed) would corrupt the ledger's source history
  // the same way an orphaned completion would.
  const { task: after, event: sourceEvent } = await store.updateTaskWithEvent(
    tenantId,
    input.taskId,
    patch,
    afterRow => ({
      eventType: transition.opsEventType,
      actorType: "human",
      actorId: input.actorId ?? null,
      beforeJson: before,
      afterJson: afterRow,
      note: input.note ?? null,
    })
  );
  if (!after) throw new Error("Ops task update failed");
  if (!sourceEvent) throw new Error("Ops task lifecycle event missing after transition");

  await mirrorOpsTaskEventToBehavioralLedger({
    tenantId,
    taskId: input.taskId,
    operatorUserId: input.actorId,
    sourceEvent,
    ledgerEventType: transition.ledgerEventType,
    ledgerStore,
  });
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
  store: OpsTaskStore = drizzleOpsTaskStore,
  ledgerStore?: BehavioralLedgerStore
): Promise<OpsTask> {
  const tenantId = input.tenantId ?? "default";
  const before = await store.getTask(tenantId, input.taskId);
  if (!before) throw new Error("Ops task not found");

  const completedAt = new Date();
  const completionPatch: Partial<InsertOpsTask> = {
    status: "completed",
    completedAt,
    completedBy: input.completedBy ?? null,
    outcome: input.outcome ?? before.outcome ?? null,
  };
  if (input.revenueRecoveredCents !== undefined) {
    completionPatch.revenueRecoveredCents = input.revenueRecoveredCents;
  }

  // Atomic compare-and-set + authoritative event insert, in one transaction.
  // The database's affected-row count, not an application-level read of
  // `before`, decides who actually performed the completion transition:
  // two simultaneous callers can both read the task as "not completed", but
  // only one UPDATE matches the `status != 'completed'` guard. Because the
  // "completed" ops_task_events row is inserted in the SAME transaction as
  // that UPDATE, a failure creating it rolls back the status change too —
  // this call can never leave a task marked completed with no authoritative
  // event behind it.
  const { transitioned, task: afterAttempt, event: completionEventFromWinner } = await store.completeTaskWithEvent(
    tenantId,
    input.taskId,
    completionPatch,
    after => ({
      eventType: "completed",
      actorType: "human",
      actorId: input.completedBy ?? null,
      beforeJson: before,
      afterJson: after,
      note: input.outcome ?? null,
      agentEventId: after.agentEventId ?? null,
    })
  );
  if (!afterAttempt) throw new Error("Ops task completion failed");

  if (!transitioned) {
    // Lost the race (or this is a genuine retry/metadata update against an
    // already-completed task). A retry may carry new outcome or revenue
    // data, but it must never manufacture a second COMPLETED event.
    const outcomeChanged = input.outcome !== undefined && input.outcome !== afterAttempt.outcome;
    const revenueChanged =
      input.revenueRecoveredCents !== undefined &&
      input.revenueRecoveredCents !== afterAttempt.revenueRecoveredCents;
    if (!outcomeChanged && !revenueChanged) return afterAttempt;

    const metadataPatch: Partial<InsertOpsTask> = {};
    if (outcomeChanged) metadataPatch.outcome = input.outcome ?? null;
    if (revenueChanged) metadataPatch.revenueRecoveredCents = input.revenueRecoveredCents;
    const after = await store.updateTask(tenantId, input.taskId, metadataPatch);
    if (!after) throw new Error("Ops task completion metadata update failed");

    if (revenueChanged) {
      await createOpsTaskEvent({
        tenantId,
        taskId: input.taskId,
        eventType: "revenue_recovered",
        actorId: input.completedBy ?? null,
        beforeJson: { revenueRecoveredCents: afterAttempt.revenueRecoveredCents },
        afterJson: { revenueRecoveredCents: after.revenueRecoveredCents },
        agentEventId: after.agentEventId ?? null,
      }, store);
    }
    if (outcomeChanged) {
      await createOpsTaskEvent({
        tenantId,
        taskId: input.taskId,
        eventType: "outcome_recorded",
        actorId: input.completedBy ?? null,
        beforeJson: { outcome: afterAttempt.outcome },
        afterJson: { outcome: after.outcome },
        agentEventId: after.agentEventId ?? null,
        note: after.outcome ?? null,
      }, store);
    }
    return after;
  }

  const after = afterAttempt;
  if (!completionEventFromWinner) throw new Error("Ops task completion event missing after transition");
  await mirrorOpsTaskEventToBehavioralLedger({
    tenantId,
    taskId: input.taskId,
    operatorUserId: input.completedBy,
    sourceEvent: completionEventFromWinner,
    ledgerEventType: "COMPLETED",
    ledgerStore,
  });

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

/** Read a single ops task (used by the resident follow-up reply flow). */
export async function getOpsTaskById(
  taskId: number,
  tenantId = "default",
  store: OpsTaskStore = drizzleOpsTaskStore
): Promise<OpsTask | null> {
  return store.getTask(tenantId, taskId);
}

/**
 * Record an operator's reply to a resident post-order follow-up: merge the
 * reply into the task's metadataJson (never overwrite the original resident
 * context), mark the task completed, and log the event. The reply is what the
 * resident app renders when the courier returns.
 */
export async function recordOpsTaskReply(
  input: {
    tenantId?: string;
    taskId: number;
    message: string;
    decision?: "approved" | "declined" | null;
    appliedOrderPatch?: Record<string, unknown> | null;
    repliedBy?: string | null;
  },
  store: OpsTaskStore = drizzleOpsTaskStore,
  ledgerStore?: BehavioralLedgerStore
): Promise<OpsTask> {
  const tenantId = input.tenantId ?? "default";
  const before = await store.getTask(tenantId, input.taskId);
  if (!before) throw new Error("Ops task not found");

  const existingMeta =
    before.metadataJson && typeof before.metadataJson === "object" && !Array.isArray(before.metadataJson)
      ? (before.metadataJson as Record<string, unknown>)
      : {};
  const existingReply =
    existingMeta.residentReply &&
    typeof existingMeta.residentReply === "object" &&
    !Array.isArray(existingMeta.residentReply)
      ? (existingMeta.residentReply as Record<string, unknown>)
      : null;
  const requestedDecision = input.decision ?? null;
  const requestedPatch = input.appliedOrderPatch ?? null;
  const requestedRepliedBy = input.repliedBy ?? null;
  const isSameReply =
    existingReply !== null &&
    existingReply.message === input.message &&
    existingReply.decision === requestedDecision &&
    existingReply.repliedBy === requestedRepliedBy &&
    sameJsonValue(existingReply.appliedOrderPatch, requestedPatch);

  // Identical network/API retry against an already-completed task: fast
  // path, no write at all.
  if (before.status === "completed" && isSameReply) return before;

  const reply = {
    message: input.message,
    decision: requestedDecision,
    appliedOrderPatch: requestedPatch,
    repliedAt: new Date().toISOString(),
    repliedBy: requestedRepliedBy,
  };

  // Same invariant and same race as completeOpsTask: two concurrent replies
  // (or a reply racing a plain completeOpsTask call) can both read the task
  // as "not completed". The atomic UPDATE below applies the completion
  // fields AND this reply's metadata together in one statement, so the
  // winner's reply lands with the completion. `transitioned` — not the
  // earlier `before` read — decides who actually completed the task.
  const completionPatch: Partial<InsertOpsTask> = {
    status: "completed",
    completedAt: new Date(),
    completedBy: requestedRepliedBy,
    outcome: `Replied to resident: ${input.message.slice(0, 180)}`,
    metadataJson: { ...existingMeta, residentReply: reply },
  };
  const { transitioned, task: afterAttempt, event: completionEventFromWinner } = await store.completeTaskWithEvent(
    tenantId,
    input.taskId,
    completionPatch,
    after => ({
      eventType: "completed",
      actorType: "human",
      actorId: requestedRepliedBy,
      beforeJson: before,
      afterJson: after,
      note: `Resident reply: ${input.message.slice(0, 180)}`,
    })
  );
  if (!afterAttempt) throw new Error("Ops task reply update failed");

  if (!transitioned) {
    // Task was already completed — by a prior reply, a concurrent
    // completeOpsTask call, or a race this call lost. Record this reply as
    // a new fact, never as a second completion.
    const currentMeta =
      afterAttempt.metadataJson &&
      typeof afterAttempt.metadataJson === "object" &&
      !Array.isArray(afterAttempt.metadataJson)
        ? (afterAttempt.metadataJson as Record<string, unknown>)
        : {};
    const currentReply =
      currentMeta.residentReply &&
      typeof currentMeta.residentReply === "object" &&
      !Array.isArray(currentMeta.residentReply)
        ? (currentMeta.residentReply as Record<string, unknown>)
        : null;
    const alreadySameReply =
      currentReply !== null &&
      currentReply.message === input.message &&
      currentReply.decision === requestedDecision &&
      currentReply.repliedBy === requestedRepliedBy &&
      sameJsonValue(currentReply.appliedOrderPatch, requestedPatch);
    if (alreadySameReply) return afterAttempt;

    const after = await store.updateTask(tenantId, input.taskId, {
      outcome: `Replied to resident: ${input.message.slice(0, 180)}`,
      metadataJson: { ...currentMeta, residentReply: reply },
    });
    if (!after) throw new Error("Ops task reply update failed");
    await createOpsTaskEvent({
      tenantId,
      taskId: input.taskId,
      eventType: "outcome_recorded",
      actorId: requestedRepliedBy,
      beforeJson: { residentReply: currentReply },
      afterJson: { residentReply: reply },
      note: `Resident reply updated: ${input.message.slice(0, 180)}`,
    }, store);
    return after;
  }

  const after = afterAttempt;
  if (!completionEventFromWinner) throw new Error("Ops task completion event missing after transition");
  await mirrorOpsTaskEventToBehavioralLedger({
    tenantId,
    taskId: input.taskId,
    operatorUserId: requestedRepliedBy,
    sourceEvent: completionEventFromWinner,
    ledgerEventType: "COMPLETED",
    ledgerStore,
  });

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
