import { describe, expect, it } from "vitest";
import type { InsertLevel4Mission, InsertOpsTask, InsertOpsTaskEvent, Level4Mission, OpsTask, OpsTaskEvent } from "../drizzle/schema";
import { completeOpsTask, createOpsTask, type ListOpsTasksInput, type OpsTaskStore } from "./opsTasks";
import {
  LEVEL4_COMPLETION_XP,
  buildLevel4MissionProgress,
  completeLevel4Mission,
  evaluateLevel4MissionUnlock,
  getCurrentLevel4MissionState,
  markLevel4MissionStarted,
  promoteNextLevel4Mission,
  type Level4MissionEvent,
  type Level4MissionStore,
} from "./level4Missions";

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
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
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

class MemoryLevel4MissionStore implements Level4MissionStore {
  missions: Level4Mission[] = [];
  events: Level4MissionEvent[] = [];
  missionId = 1;
  eventId = 1;

  constructor(private taskStore: MemoryOpsTaskStore) {}

  async createMission(input: InsertLevel4Mission): Promise<Level4Mission> {
    const now = new Date();
    const mission = {
      id: this.missionId++,
      tenantId: input.tenantId ?? "default",
      operatorId: input.operatorId ?? "tenant_proxy",
      taskId: input.taskId,
      status: input.status ?? "locked",
      missionDate: input.missionDate,
      activatedAt: input.activatedAt ?? now,
      unlockedAt: input.unlockedAt ?? null,
      startedAt: input.startedAt ?? null,
      completedAt: input.completedAt ?? null,
      expiredAt: input.expiredAt ?? null,
      visibleUntil: input.visibleUntil ?? null,
      xpAwarded: input.xpAwarded ?? 0,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    } satisfies Level4Mission;
    this.missions.push(mission);
    return mission;
  }

  async updateMission(tenantId: string, missionId: number, patch: Partial<InsertLevel4Mission>): Promise<Level4Mission | null> {
    const mission = await this.getMission(tenantId, missionId);
    if (!mission) return null;
    Object.assign(mission, patch, { updatedAt: new Date() });
    return mission;
  }

  async listMissions(input: { tenantId: string; operatorId: string; statuses?: Level4Mission["status"][]; limit?: number }): Promise<Level4Mission[]> {
    return this.missions
      .filter((mission) => {
        if (mission.tenantId !== input.tenantId || mission.operatorId !== input.operatorId) return false;
        if (input.statuses?.length && !input.statuses.includes(mission.status)) return false;
        return true;
      })
      .sort((a, b) => b.activatedAt.getTime() - a.activatedAt.getTime() || b.id - a.id)
      .slice(0, input.limit ?? 10);
  }

  async getMission(tenantId: string, missionId: number): Promise<Level4Mission | null> {
    return this.missions.find((mission) => mission.tenantId === tenantId && mission.id === missionId) ?? null;
  }

  async listCandidateTasks(tenantId: string, operatorId: string): Promise<OpsTask[]> {
    return this.taskStore.tasks.filter((task) => task.tenantId === tenantId && task.lane === "level_4" && ["open", "accepted", "in_progress"].includes(task.status));
  }

  async getTask(tenantId: string, taskId: number): Promise<OpsTask | null> {
    return this.taskStore.getTask(tenantId, taskId);
  }

  async createAgentEvent(input: Omit<Level4MissionEvent, "id" | "createdAt">): Promise<Level4MissionEvent> {
    const event = { ...input, id: this.eventId++, createdAt: new Date() };
    this.events.push(event);
    return event;
  }
}

async function laneTask(store: MemoryOpsTaskStore, lane: "lane_1" | "lane_2" | "lane_3", completedBy = "op1") {
  const level = lane.replace("lane_", "") as "1" | "2" | "3";
  const task = await createOpsTask({
    tenantId: "default",
    lane,
    level,
    taskType: lane === "lane_3" ? "unpaid_order" : "manual_operator_task",
    title: `${lane} task`,
  }, store);
  return completeOpsTask({ tenantId: "default", taskId: task.id, completedBy, revenueRecoveredCents: lane === "lane_3" ? 1000 : undefined }, store);
}

describe("level4 mission connective tissue", () => {
  it("promotes the highest-priority Lane 4 task as a locked mission", async () => {
    const ops = new MemoryOpsTaskStore();
    const missions = new MemoryLevel4MissionStore(ops);
    await createOpsTask({ tenantId: "default", lane: "level_4", level: "4", taskType: "gm_followup", title: "Low", revenueAtRiskCents: 1000 }, ops);
    const high = await createOpsTask({ tenantId: "default", lane: "level_4", level: "4", taskType: "gm_followup", title: "High", revenueAtRiskCents: 9000 }, ops);

    const mission = await promoteNextLevel4Mission({ tenantId: "default", operatorId: "op1", now: new Date("2026-05-12T16:00:00Z"), store: missions });

    expect(mission?.taskId).toBe(high.id);
    expect(mission?.status).toBe("locked");
    expect(missions.events[0].outputJson).toMatchObject({ eventName: "mission_activated" });
  });

  it("unlocks after 5 Lane 1-3 tasks and 100 XP", async () => {
    const ops = new MemoryOpsTaskStore();
    const missions = new MemoryLevel4MissionStore(ops);
    await createOpsTask({ tenantId: "default", lane: "level_4", level: "4", taskType: "gm_followup", title: "Mission" }, ops);
    for (let i = 0; i < 5; i += 1) await laneTask(ops, "lane_1", "op1");

    const state = await evaluateLevel4MissionUnlock({ tenantId: "default", operatorId: "op1", now: new Date(), store: missions, taskStore: ops });

    expect(state.mission?.status).toBe("unlocked");
    expect(state.accessible).toBe(true);
    expect(missions.events.some((event) => (event.outputJson as any).eventName === "mission_unlocked")).toBe(true);
  });

  it("keeps locked missions inaccessible with progress", async () => {
    const ops = new MemoryOpsTaskStore();
    const missions = new MemoryLevel4MissionStore(ops);
    await createOpsTask({ tenantId: "default", lane: "level_4", level: "4", taskType: "gm_followup", title: "Mission" }, ops);
    await laneTask(ops, "lane_1", "op1");

    const state = await getCurrentLevel4MissionState({ tenantId: "default", operatorId: "op1", now: new Date(), store: missions, taskStore: ops });

    expect(state.boardState).toBe("locked");
    expect(state.accessible).toBe(false);
    expect(state.progress.remainingTasks).toBe(4);
  });

  it("logs mission_started when an unlocked mission is entered", async () => {
    const ops = new MemoryOpsTaskStore();
    const missions = new MemoryLevel4MissionStore(ops);
    await createOpsTask({ tenantId: "default", lane: "level_4", level: "4", taskType: "gm_followup", title: "Mission" }, ops);
    for (let i = 0; i < 5; i += 1) await laneTask(ops, "lane_1", "op1");
    await evaluateLevel4MissionUnlock({ tenantId: "default", operatorId: "op1", store: missions, taskStore: ops });

    await markLevel4MissionStarted({ tenantId: "default", operatorId: "op1", store: missions });

    expect(missions.missions[0].startedAt).toBeTruthy();
    expect(missions.events.some((event) => (event.outputJson as any).eventName === "mission_started")).toBe(true);
  });

  it("completion marks the Lane 4 task completed, awards XP, creates reflection proof, and stays visible", async () => {
    const ops = new MemoryOpsTaskStore();
    const missions = new MemoryLevel4MissionStore(ops);
    const task = await createOpsTask({ tenantId: "default", lane: "level_4", level: "4", taskType: "gm_followup", title: "Mission", revenueAtRiskCents: 50000 }, ops);
    for (let i = 0; i < 5; i += 1) await laneTask(ops, "lane_1", "op1");
    await evaluateLevel4MissionUnlock({ tenantId: "default", operatorId: "op1", store: missions, taskStore: ops });

    const state = await completeLevel4Mission({ tenantId: "default", operatorId: "op1", completedBy: "op1", store: missions, taskStore: ops });

    expect((await ops.getTask("default", task.id))?.status).toBe("completed");
    expect(state.mission?.xpAwarded).toBe(LEVEL4_COMPLETION_XP);
    expect(state.boardState).toBe("completed");
    expect(missions.events.find((event) => (event.outputJson as any).eventName === "mission_completed")?.outputJson).toMatchObject({
      xpAwarded: 500,
      reflection: {
        revenueProtectedCents: 50000,
        relationshipAdvanced: true,
        operationalBreakthrough: true,
        growthActionCompleted: true,
      },
    });
  });

  it("does not auto-promote the next mission until the next day", async () => {
    const ops = new MemoryOpsTaskStore();
    const missions = new MemoryLevel4MissionStore(ops);
    await createOpsTask({ tenantId: "default", lane: "level_4", level: "4", taskType: "gm_followup", title: "Today" }, ops);
    const tomorrow = await createOpsTask({ tenantId: "default", lane: "level_4", level: "4", taskType: "gm_followup", title: "Tomorrow" }, ops);
    for (let i = 0; i < 5; i += 1) await laneTask(ops, "lane_1", "op1");
    await evaluateLevel4MissionUnlock({ tenantId: "default", operatorId: "op1", now: new Date("2026-05-12T16:00:00Z"), store: missions, taskStore: ops });
    await completeLevel4Mission({ tenantId: "default", operatorId: "op1", now: new Date("2026-05-12T17:00:00Z"), store: missions, taskStore: ops });

    const sameDay = await getCurrentLevel4MissionState({ tenantId: "default", operatorId: "op1", now: new Date("2026-05-12T18:00:00Z"), store: missions, taskStore: ops });
    const nextDay = await getCurrentLevel4MissionState({ tenantId: "default", operatorId: "op1", now: new Date("2026-05-13T16:00:00Z"), store: missions, taskStore: ops });

    expect(sameDay.mission?.status).toBe("completed");
    expect(nextDay.mission?.taskId).toBe(tomorrow.id);
    expect(nextDay.mission?.status).toBe("locked");
  });

  it("expires stale active missions neutrally and logs the transition", async () => {
    const ops = new MemoryOpsTaskStore();
    const missions = new MemoryLevel4MissionStore(ops);
    await createOpsTask({ tenantId: "default", lane: "level_4", level: "4", taskType: "gm_followup", title: "Old mission" }, ops);
    await promoteNextLevel4Mission({ tenantId: "default", operatorId: "op1", now: new Date("2026-05-12T16:00:00Z"), store: missions });

    await getCurrentLevel4MissionState({ tenantId: "default", operatorId: "op1", now: new Date("2026-05-13T16:00:00Z"), store: missions, taskStore: ops });

    expect(missions.missions.some((mission) => mission.status === "expired")).toBe(true);
    expect(missions.events.some((event) => (event.outputJson as any).eventName === "mission_expired")).toBe(true);
  });

  it("keeps multiple operators independent", async () => {
    const ops = new MemoryOpsTaskStore();
    const missions = new MemoryLevel4MissionStore(ops);
    await createOpsTask({ tenantId: "default", lane: "level_4", level: "4", taskType: "gm_followup", title: "Mission" }, ops);

    const a = await promoteNextLevel4Mission({ tenantId: "default", operatorId: "op1", store: missions });
    const b = await promoteNextLevel4Mission({ tenantId: "default", operatorId: "op2", store: missions });

    expect(a?.operatorId).toBe("op1");
    expect(b?.operatorId).toBe("op2");
    expect(a?.id).not.toBe(b?.id);
  });

  it("computes the unlock threshold from today's completed Lane 1-3 work only", async () => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const tasks: OpsTask[] = [
      { id: 1, tenantId: "default", lane: "lane_1", level: "1", taskType: "manual_operator_task", title: "today", description: null, source: "manual", createdBy: null, assignedTo: null, status: "completed", priority: "normal", revenueAtRiskCents: 0, revenueRecoveredCents: 0, customerId: null, orderId: null, agentEventId: null, metadataJson: null, outcome: null, createdAt: today, updatedAt: today, completedAt: today, completedBy: "op1" },
      { id: 2, tenantId: "default", lane: "lane_1", level: "1", taskType: "manual_operator_task", title: "old", description: null, source: "manual", createdBy: null, assignedTo: null, status: "completed", priority: "normal", revenueAtRiskCents: 0, revenueRecoveredCents: 0, customerId: null, orderId: null, agentEventId: null, metadataJson: null, outcome: null, createdAt: yesterday, updatedAt: yesterday, completedAt: yesterday, completedBy: "op1" },
      { id: 3, tenantId: "default", lane: "level_4", level: "4", taskType: "gm_followup", title: "l4", description: null, source: "manual", createdBy: null, assignedTo: null, status: "completed", priority: "normal", revenueAtRiskCents: 0, revenueRecoveredCents: 0, customerId: null, orderId: null, agentEventId: null, metadataJson: null, outcome: null, createdAt: today, updatedAt: today, completedAt: today, completedBy: "op1" },
    ];

    const progress = buildLevel4MissionProgress(tasks, today);

    expect(progress.completedLaneTasks).toBe(1);
    expect(progress.laneXp).toBe(20);
  });
});
