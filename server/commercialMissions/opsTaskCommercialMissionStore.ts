import { and, desc, eq } from "drizzle-orm";
import { opsTaskEvents, opsTasks, type OpsTask } from "../../drizzle/schema";
import { getDb } from "../db";
import {
  type CommercialMission,
  type CommercialMissionStatus,
} from "@shared/commercialMission";
import {
  transitionCommercialMission,
  type CommercialMissionLifecycleEvent,
} from "@shared/commercialMissionLifecycle";

const COMMERCIAL_MISSION_METADATA_KIND = "commercial_mission_v1" as const;

export type CommercialMissionTaskMetadata = {
  kind: typeof COMMERCIAL_MISSION_METADATA_KIND;
  mission: CommercialMission;
  lastLifecycleEvent: CommercialMissionLifecycleEvent | null;
};

function actorTypeForOps(
  actorType: CommercialMissionLifecycleEvent["actorType"]
): "human" | "driver" | "system" {
  if (actorType === "driver") return "driver";
  if (actorType === "system" || actorType === "game") return "system";
  return "human";
}

export function opsStatusForCommercialMission(
  status: CommercialMissionStatus
): OpsTask["status"] {
  if (status === "won" || status === "lost") return "completed";
  if (
    status === "game_active" ||
    status === "game_completed" ||
    status === "phone_ready" ||
    status === "preparing" ||
    status === "en_route" ||
    status === "arrived" ||
    status === "visit_completed" ||
    status === "follow_up"
  ) {
    return "in_progress";
  }
  return "open";
}

export function encodeCommercialMissionMetadata(
  mission: CommercialMission,
  lastLifecycleEvent: CommercialMissionLifecycleEvent | null = null
): CommercialMissionTaskMetadata {
  return {
    kind: COMMERCIAL_MISSION_METADATA_KIND,
    mission,
    lastLifecycleEvent,
  };
}

export function decodeCommercialMissionMetadata(
  value: unknown
): CommercialMissionTaskMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<CommercialMissionTaskMetadata>;
  if (candidate.kind !== COMMERCIAL_MISSION_METADATA_KIND) return null;
  if (!candidate.mission || typeof candidate.mission !== "object") return null;
  if (
    typeof candidate.mission.id !== "number" ||
    typeof candidate.mission.code !== "string" ||
    typeof candidate.mission.accountName !== "string" ||
    typeof candidate.mission.status !== "string"
  ) {
    return null;
  }
  return candidate as CommercialMissionTaskMetadata;
}

export type PersistedCommercialMission = {
  taskId: number;
  task: OpsTask;
  mission: CommercialMission;
};

export async function createPersistedCommercialMission(input: {
  mission: CommercialMission;
  actorId?: string | null;
}): Promise<PersistedCommercialMission> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const mission = input.mission;
  const metadataJson = encodeCommercialMissionMetadata(mission);
  const insert = await db.insert(opsTasks).values({
    tenantId: mission.tenantId,
    lane: "level_4",
    level: "4",
    taskType: "gm_followup",
    title: `${mission.code} · ${mission.accountName}`,
    description: mission.laundryOpportunity,
    source: "agent_suggested",
    createdBy: input.actorId ?? "dayforge-radar",
    assignedTo: null,
    status: opsStatusForCommercialMission(mission.status),
    priority: mission.estimateConfidence === "high" ? "high" : "normal",
    revenueAtRiskCents: mission.estimatedAnnualValueCents,
    revenueRecoveredCents: 0,
    customerId: null,
    orderId: null,
    agentEventId: null,
    metadataJson,
    outcome: null,
  });
  const taskId = Number(insert[0].insertId);

  await db.insert(opsTaskEvents).values({
    tenantId: mission.tenantId,
    taskId,
    eventType: "agent_suggested",
    actorType: "system",
    actorId: input.actorId ?? "dayforge-radar",
    beforeJson: null,
    afterJson: metadataJson,
    note: `${mission.code} created for ${mission.accountName}`,
  });

  const rows = await db
    .select()
    .from(opsTasks)
    .where(and(eq(opsTasks.tenantId, mission.tenantId), eq(opsTasks.id, taskId)))
    .limit(1);
  const task = rows[0];
  if (!task) throw new Error("Commercial mission task insert did not return a row");

  return { taskId, task, mission };
}

export async function getPersistedCommercialMission(input: {
  tenantId: string;
  taskId: number;
}): Promise<PersistedCommercialMission | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(opsTasks)
    .where(and(eq(opsTasks.tenantId, input.tenantId), eq(opsTasks.id, input.taskId)))
    .limit(1);
  const task = rows[0];
  if (!task) return null;
  const metadata = decodeCommercialMissionMetadata(task.metadataJson);
  if (!metadata) return null;
  return { taskId: task.id, task, mission: metadata.mission };
}

export async function listPersistedCommercialMissions(input: {
  tenantId: string;
  limit?: number;
}): Promise<PersistedCommercialMission[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(opsTasks)
    .where(and(eq(opsTasks.tenantId, input.tenantId), eq(opsTasks.lane, "level_4")))
    .orderBy(desc(opsTasks.createdAt), desc(opsTasks.id))
    .limit(Math.min(Math.max(input.limit ?? 100, 1), 250));

  return rows.flatMap(task => {
    const metadata = decodeCommercialMissionMetadata(task.metadataJson);
    return metadata ? [{ taskId: task.id, task, mission: metadata.mission }] : [];
  });
}

export async function transitionPersistedCommercialMission(input: {
  tenantId: string;
  taskId: number;
  toStatus: CommercialMissionStatus;
  actorType: CommercialMissionLifecycleEvent["actorType"];
  actorId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<PersistedCommercialMission> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const current = await getPersistedCommercialMission({
    tenantId: input.tenantId,
    taskId: input.taskId,
  });
  if (!current) throw new Error("Commercial mission not found");

  if (current.mission.status === input.toStatus) return current;

  const transitioned = transitionCommercialMission(current.mission, input.toStatus, {
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    metadata: input.metadata,
  });
  const metadataJson = encodeCommercialMissionMetadata(
    transitioned.mission,
    transitioned.event
  );
  const terminal = input.toStatus === "won" || input.toStatus === "lost";

  await db
    .update(opsTasks)
    .set({
      status: opsStatusForCommercialMission(input.toStatus),
      metadataJson,
      outcome:
        input.toStatus === "won"
          ? `Account won: ${transitioned.mission.accountName}`
          : input.toStatus === "lost"
            ? `Account lost: ${transitioned.mission.accountName}`
            : current.task.outcome,
      completedAt: terminal ? new Date(transitioned.event.occurredAt) : null,
      completedBy: terminal ? input.actorId ?? null : null,
    })
    .where(and(eq(opsTasks.tenantId, input.tenantId), eq(opsTasks.id, input.taskId)));

  await db.insert(opsTaskEvents).values({
    tenantId: input.tenantId,
    taskId: input.taskId,
    eventType: terminal ? "completed" : "accepted",
    actorType: actorTypeForOps(input.actorType),
    actorId: input.actorId ?? null,
    beforeJson: encodeCommercialMissionMetadata(current.mission),
    afterJson: metadataJson,
    note: `${transitioned.event.eventName}: ${current.mission.status} → ${input.toStatus}`,
  });

  const updated = await getPersistedCommercialMission({
    tenantId: input.tenantId,
    taskId: input.taskId,
  });
  if (!updated) throw new Error("Commercial mission update did not return a row");
  return updated;
}
