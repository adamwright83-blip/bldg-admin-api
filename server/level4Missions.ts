import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  agentEvents,
  level4Missions,
  opsTasks,
  type InsertLevel4Mission,
  type Level4Mission,
  type OpsTask,
} from "../drizzle/schema";
import { getDb } from "./db";
import { completeOpsTask, listOpsTasks, type OpsTaskStore } from "./opsTasks";
import { getDashboardBusinessDayBoundsUtc } from "./revenueIntervention";

export type Level4MissionStatus = Level4Mission["status"];

export type Level4MissionProgress = {
  completedLaneTasks: number;
  requiredLaneTasks: number;
  laneXp: number;
  requiredLaneXp: number;
  remainingTasks: number;
  remainingXp: number;
  percent: number;
  message: string;
};

export type Level4MissionState = {
  mission: Level4Mission | null;
  task: OpsTask | null;
  progress: Level4MissionProgress;
  boardState: "none" | "locked" | "unlocked" | "completed";
  accessible: boolean;
  xpReward: number;
};

export type Level4MissionEvent = {
  id: number;
  tenantId: string;
  agentType: "system_agent";
  actorType: "system";
  actorId: string | null;
  toolName: "level4MissionStateChange";
  entityType: "level4_mission";
  entityId: string;
  inputJson: unknown;
  outputJson: unknown;
  status: "success" | "failed";
  createdAt: Date;
};

export type Level4MissionStore = {
  createMission(input: InsertLevel4Mission): Promise<Level4Mission>;
  updateMission(tenantId: string, missionId: number, patch: Partial<InsertLevel4Mission>): Promise<Level4Mission | null>;
  listMissions(input: { tenantId: string; operatorId: string; statuses?: Level4MissionStatus[]; limit?: number }): Promise<Level4Mission[]>;
  getMission(tenantId: string, missionId: number): Promise<Level4Mission | null>;
  listCandidateTasks(tenantId: string, operatorId: string): Promise<OpsTask[]>;
  getTask(tenantId: string, taskId: number): Promise<OpsTask | null>;
  createAgentEvent(input: Omit<Level4MissionEvent, "id" | "createdAt">): Promise<Level4MissionEvent | null>;
};

export const LEVEL4_UNLOCK_TASKS = 5;
export const LEVEL4_UNLOCK_XP = 100;
export const LEVEL4_COMPLETION_XP = 500;
export const LEVEL4_COMPLETED_VISIBILITY_MS = 2 * 60 * 60 * 1000;

const ACTIVE_STATUSES: Level4MissionStatus[] = ["locked", "unlocked"];
const BOARD_STATUSES: Level4MissionStatus[] = ["locked", "unlocked", "completed"];

function operatorKey(operatorId?: string | null) {
  return operatorId || "tenant_proxy";
}

function laneTaskXp(task: OpsTask): number {
  if (task.lane === "lane_1") return 20;
  if (task.lane === "lane_2") return 25;
  if (task.lane === "lane_3") return Math.max(30, Math.floor((task.revenueRecoveredCents || 0) / 100));
  return 0;
}

function isLaneOneToThree(task: OpsTask) {
  return task.lane === "lane_1" || task.lane === "lane_2" || task.lane === "lane_3";
}

function metadata(task: OpsTask): Record<string, unknown> {
  return typeof task.metadataJson === "object" && task.metadataJson !== null ? task.metadataJson as Record<string, unknown> : {};
}

function isPinned(task: OpsTask) {
  return metadata(task).level4Pinned === true || metadata(task).strategicImportance === "pinned";
}

function isStrategic(task: OpsTask) {
  return metadata(task).strategicImportance === true || metadata(task).strategicImportance === "high";
}

function priorityRank(task: OpsTask): number {
  if (isPinned(task)) return 1_000_000_000;
  const strategic = isStrategic(task) ? 100_000_000 : 0;
  return strategic + (task.revenueAtRiskCents || 0);
}

function missionDay(now: Date) {
  return getDashboardBusinessDayBoundsUtc(now).ymd;
}

function progressMessage(remainingTasks: number, remainingXp: number) {
  const parts: string[] = [];
  if (remainingTasks > 0) parts.push(`Complete ${remainingTasks} more Lane 1-3 task${remainingTasks === 1 ? "" : "s"}`);
  if (remainingXp > 0) parts.push(`earn ${remainingXp} more XP from Lane 1-3 work`);
  return parts.length ? `${parts.join(" and ")} to unlock.` : "Mission unlocked.";
}

export function buildLevel4MissionProgress(tasks: OpsTask[], now = new Date()): Level4MissionProgress {
  const bounds = getDashboardBusinessDayBoundsUtc(now);
  const completedToday = tasks.filter((task) => {
    if (!isLaneOneToThree(task) || task.status !== "completed" || !task.completedAt) return false;
    const completedAt = task.completedAt instanceof Date ? task.completedAt : new Date(task.completedAt);
    return completedAt >= bounds.startUtc && completedAt < bounds.endUtc;
  });
  const completedLaneTasks = completedToday.length;
  const laneXp = completedToday.reduce((sum, task) => sum + laneTaskXp(task), 0);
  const remainingTasks = Math.max(0, LEVEL4_UNLOCK_TASKS - completedLaneTasks);
  const remainingXp = Math.max(0, LEVEL4_UNLOCK_XP - laneXp);
  const taskPct = Math.min(1, completedLaneTasks / LEVEL4_UNLOCK_TASKS);
  const xpPct = Math.min(1, laneXp / LEVEL4_UNLOCK_XP);
  return {
    completedLaneTasks,
    requiredLaneTasks: LEVEL4_UNLOCK_TASKS,
    laneXp,
    requiredLaneXp: LEVEL4_UNLOCK_XP,
    remainingTasks,
    remainingXp,
    percent: Math.round(((taskPct + xpPct) / 2) * 100),
    message: progressMessage(remainingTasks, remainingXp),
  };
}

const drizzleLevel4MissionStore: Level4MissionStore = {
  async createMission(input) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const result = await db.insert(level4Missions).values(input);
    const id = Number(result[0].insertId);
    const rows = await db.select().from(level4Missions).where(eq(level4Missions.id, id)).limit(1);
    if (!rows[0]) throw new Error("Level 4 mission insert did not return a row");
    return rows[0];
  },
  async updateMission(tenantId, missionId, patch) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    await db.update(level4Missions).set(patch).where(and(eq(level4Missions.tenantId, tenantId), eq(level4Missions.id, missionId)));
    const rows = await db.select().from(level4Missions).where(and(eq(level4Missions.tenantId, tenantId), eq(level4Missions.id, missionId))).limit(1);
    return rows[0] ?? null;
  },
  async listMissions(input) {
    const db = await getDb();
    if (!db) return [];
    const clauses = [eq(level4Missions.tenantId, input.tenantId), eq(level4Missions.operatorId, input.operatorId)];
    if (input.statuses?.length) clauses.push(inArray(level4Missions.status, input.statuses));
    return db.select().from(level4Missions).where(and(...clauses)).orderBy(desc(level4Missions.activatedAt), desc(level4Missions.id)).limit(input.limit ?? 10);
  },
  async getMission(tenantId, missionId) {
    const db = await getDb();
    if (!db) return null;
    const rows = await db.select().from(level4Missions).where(and(eq(level4Missions.tenantId, tenantId), eq(level4Missions.id, missionId))).limit(1);
    return rows[0] ?? null;
  },
  async listCandidateTasks(tenantId, operatorId) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(opsTasks)
      .where(and(eq(opsTasks.tenantId, tenantId), eq(opsTasks.lane, "level_4"), inArray(opsTasks.status, ["open", "accepted", "in_progress"])))
      .orderBy(desc(opsTasks.revenueAtRiskCents), asc(opsTasks.createdAt), asc(opsTasks.id))
      .limit(100);
  },
  async getTask(tenantId, taskId) {
    const db = await getDb();
    if (!db) return null;
    const rows = await db.select().from(opsTasks).where(and(eq(opsTasks.tenantId, tenantId), eq(opsTasks.id, taskId))).limit(1);
    return rows[0] ?? null;
  },
  async createAgentEvent(input) {
    const db = await getDb();
    if (!db) return null;
    const result = await db.insert(agentEvents).values({
      tenantId: input.tenantId,
      agentType: input.agentType,
      actorType: input.actorType,
      actorId: input.actorId,
      toolName: input.toolName,
      entityType: input.entityType,
      entityId: input.entityId,
      inputJson: input.inputJson,
      outputJson: input.outputJson,
      status: input.status,
    });
    const id = Number(result[0].insertId);
    return { ...input, id, createdAt: new Date() };
  },
};

async function logStateChange(
  tenantId: string,
  operatorId: string,
  mission: Level4Mission,
  eventName: "mission_activated" | "mission_unlocked" | "mission_started" | "mission_completed" | "mission_expired",
  previous: unknown,
  next: unknown,
  store: Level4MissionStore
) {
  await store.createAgentEvent({
    tenantId,
    agentType: "system_agent",
    actorType: "system",
    actorId: operatorId,
    toolName: "level4MissionStateChange",
    entityType: "level4_mission",
    entityId: String(mission.id),
    inputJson: previous,
    outputJson: { eventName, ...((next && typeof next === "object") ? next as Record<string, unknown> : { next }) },
    status: "success",
  });
}

async function expireStaleMissions(tenantId: string, operatorId: string, now: Date, store: Level4MissionStore) {
  const today = missionDay(now);
  const active = await store.listMissions({ tenantId, operatorId, statuses: ACTIVE_STATUSES, limit: 10 });
  for (const mission of active) {
    if (mission.missionDate >= today) continue;
    const previous = { status: mission.status, missionDate: mission.missionDate };
    const expired = await store.updateMission(tenantId, mission.id, { status: "expired", expiredAt: now });
    if (expired) await logStateChange(tenantId, operatorId, expired, "mission_expired", previous, { status: expired.status, expiredAt: expired.expiredAt }, store);
  }
}

export async function promoteNextLevel4Mission(input: {
  tenantId?: string;
  operatorId?: string | null;
  now?: Date;
  store?: Level4MissionStore;
}): Promise<Level4Mission | null> {
  const tenantId = input.tenantId ?? "default";
  const operatorId = operatorKey(input.operatorId);
  const now = input.now ?? new Date();
  const store = input.store ?? drizzleLevel4MissionStore;
  await expireStaleMissions(tenantId, operatorId, now, store);
  const existing = await store.listMissions({ tenantId, operatorId, statuses: ACTIVE_STATUSES, limit: 1 });
  if (existing[0]) return existing[0];
  const completedToday = await store.listMissions({ tenantId, operatorId, statuses: ["completed"], limit: 1 });
  if (completedToday[0]?.missionDate === missionDay(now)) return completedToday[0];

  const candidates = await store.listCandidateTasks(tenantId, operatorId);
  const task = candidates.sort((a, b) => priorityRank(b) - priorityRank(a) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];
  if (!task) return null;

  const mission = await store.createMission({
    tenantId,
    operatorId,
    taskId: task.id,
    status: "locked",
    missionDate: missionDay(now),
    activatedAt: now,
    xpAwarded: 0,
  });
  await logStateChange(tenantId, operatorId, mission, "mission_activated", null, { status: mission.status, taskId: task.id, missionDate: mission.missionDate }, store);
  return mission;
}

export async function evaluateLevel4MissionUnlock(input: {
  tenantId?: string;
  operatorId?: string | null;
  now?: Date;
  store?: Level4MissionStore;
  taskStore?: OpsTaskStore;
}): Promise<Level4MissionState> {
  const tenantId = input.tenantId ?? "default";
  const operatorId = operatorKey(input.operatorId);
  const now = input.now ?? new Date();
  const store = input.store ?? drizzleLevel4MissionStore;
  const mission = await promoteNextLevel4Mission({ tenantId, operatorId, now, store });
  const tasks = await listOpsTasks({ tenantId, limit: 500 }, input.taskStore);
  const progress = buildLevel4MissionProgress(tasks, now);
  let current = mission;
  if (current?.status === "locked" && progress.remainingTasks === 0 && progress.remainingXp === 0) {
    const previous = { status: current.status, progress };
    current = await store.updateMission(tenantId, current.id, { status: "unlocked", unlockedAt: now });
    if (current) await logStateChange(tenantId, operatorId, current, "mission_unlocked", previous, { status: current.status, progress }, store);
  }
  const task = current ? await store.getTask(tenantId, current.taskId) : null;
  return buildMissionState(current, task, progress, now);
}

export async function getCurrentLevel4MissionState(input: {
  tenantId?: string;
  operatorId?: string | null;
  now?: Date;
  store?: Level4MissionStore;
  taskStore?: OpsTaskStore;
}): Promise<Level4MissionState> {
  return evaluateLevel4MissionUnlock(input);
}

export async function markLevel4MissionStarted(input: {
  tenantId?: string;
  operatorId?: string | null;
  now?: Date;
  store?: Level4MissionStore;
}): Promise<Level4MissionState> {
  const tenantId = input.tenantId ?? "default";
  const operatorId = operatorKey(input.operatorId);
  const now = input.now ?? new Date();
  const store = input.store ?? drizzleLevel4MissionStore;
  const state = await getCurrentLevel4MissionState({ tenantId, operatorId, now, store });
  if (!state.mission || state.mission.status !== "unlocked") return state;
  if (!state.mission.startedAt) {
    const previous = { status: state.mission.status, startedAt: state.mission.startedAt };
    const started = await store.updateMission(tenantId, state.mission.id, { startedAt: now });
    if (started) {
      await logStateChange(tenantId, operatorId, started, "mission_started", previous, { status: started.status, startedAt: started.startedAt }, store);
      return buildMissionState(started, state.task, state.progress, now);
    }
  }
  return state;
}

export async function completeLevel4Mission(input: {
  tenantId?: string;
  operatorId?: string | null;
  completedBy?: string | null;
  outcome?: string | null;
  now?: Date;
  store?: Level4MissionStore;
  taskStore?: OpsTaskStore;
}): Promise<Level4MissionState> {
  const tenantId = input.tenantId ?? "default";
  const operatorId = operatorKey(input.operatorId);
  const now = input.now ?? new Date();
  const store = input.store ?? drizzleLevel4MissionStore;
  const state = await getCurrentLevel4MissionState({ tenantId, operatorId, now, store, taskStore: input.taskStore });
  if (!state.mission) throw new Error("No active Level 4 mission");
  if (state.mission.status !== "unlocked") throw new Error("Level 4 mission is still locked");

  const task = await completeOpsTask({
    tenantId,
    taskId: state.mission.taskId,
    completedBy: input.completedBy ?? operatorId,
    outcome: input.outcome ?? "Level 4 mission completed. Revenue protected, relationship advanced, operational breakthrough logged.",
    revenueRecoveredCents: state.task?.revenueAtRiskCents ?? undefined,
  }, input.taskStore);
  const previous = { status: state.mission.status, taskId: state.mission.taskId };
  const completed = await store.updateMission(tenantId, state.mission.id, {
    status: "completed",
    completedAt: now,
    visibleUntil: new Date(now.getTime() + LEVEL4_COMPLETED_VISIBILITY_MS),
    xpAwarded: LEVEL4_COMPLETION_XP,
  });
  if (!completed) throw new Error("Level 4 mission completion failed");
  await logStateChange(tenantId, operatorId, completed, "mission_completed", previous, {
    status: completed.status,
    taskId: task.id,
    xpAwarded: LEVEL4_COMPLETION_XP,
    reflection: {
      revenueProtectedCents: task.revenueRecoveredCents,
      relationshipAdvanced: true,
      operationalBreakthrough: true,
      growthActionCompleted: true,
    },
  }, store);
  return buildMissionState(completed, task, state.progress, now);
}

function buildMissionState(
  mission: Level4Mission | null,
  task: OpsTask | null,
  progress: Level4MissionProgress,
  now: Date
): Level4MissionState {
  const visibleCompleted = mission?.status === "completed" && mission.visibleUntil && new Date(mission.visibleUntil).getTime() > now.getTime();
  return {
    mission: visibleCompleted || mission?.status !== "completed" ? mission : null,
    task: visibleCompleted || mission?.status !== "completed" ? task : null,
    progress,
    boardState: !mission ? "none" : visibleCompleted ? "completed" : mission.status === "unlocked" ? "unlocked" : mission.status === "locked" ? "locked" : "none",
    accessible: mission?.status === "unlocked",
    xpReward: LEVEL4_COMPLETION_XP,
  };
}
