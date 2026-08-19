/**
 * DAY 1 — THE TEN DOORS (emergency, narrowly-scoped build — see
 * shared/day1TenDoors.ts for the "why" and the full truth rails).
 *
 * Reuses the EXISTING open_channel_missions / open_channel_mission_tasks
 * tables and the same JSON-in-`detail` convention `shared/localTargetRun.ts`
 * already established — zero schema changes, zero migration. This mission
 * is exactly one task whose `detail` decodes as a `Day1TenDoorsPayload`
 * instead of a `LocalTargetRunPayload`; `decodeDay1Payload` only ever
 * matches that shape, so it can never collide with an ordinary task or a
 * LOCAL_TARGET_RUN task's detail.
 *
 * The mission is created directly in `status: "active"` — there is no
 * draft/approve step for Day 1, by design (§ "the operator has explicitly
 * declared" the mission; nothing here is model output that needs
 * confirming). It is auto-seeded once per driver per business date and is
 * stable across reloads: `getOrCreateDay1TenDoorsMission` returns the same
 * mission (same 10 targets, same recorded outcomes) every time it is
 * called for the same driver + businessDate.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  openChannelMissionTasks,
  openChannelMissions,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { ensureOpenChannelTables } from "./openChannelService";
import {
  DAY1_BUSINESS_DATE,
  DAY1_MISSION_LINE,
  DAY1_TARGETS,
  DAY1_TITLE,
  day1CurrentTarget,
  day1IsComplete,
  day1OutcomeCounts,
  day1ProgressLabel,
  day1VisitedCount,
  decodeDay1Payload,
  encodeDay1Payload,
  type Day1Target,
  type Day1TargetOutcome,
  type Day1TenDoorsPayload,
} from "../../shared/day1TenDoors";
import type {
  Day1DecisionMakerStatus,
  Day1EvidenceEvent,
  Day1EvidencePayloadExtension,
  Day1EvidenceSource,
  Day1RecordEvidenceInput,
  Day1VisitEvidence,
} from "../../shared/day1Evidence";

type EvidencePayload = Day1TenDoorsPayload & Day1EvidencePayloadExtension;

export type Day1TenDoorsMission = {
  missionId: string;
  taskId: string;
  businessDate: string;
  title: string;
  briefing: string;
  targets: Day1Target[];
  outcomes: Record<string, Day1TargetOutcome>;
  currentTarget: Day1Target | null;
  progressLabel: string | null;
  visitedCount: number;
  totalCount: number;
  isComplete: boolean;
  outcomeCounts: { pitched: number; couldntReach: number };
  evidenceEvents: Day1EvidenceEvent[];
  visitEvidence: Record<string, Day1VisitEvidence>;
};

function normaliseEvidence(payload: Day1TenDoorsPayload): EvidencePayload {
  const candidate = payload as EvidencePayload;
  return {
    ...payload,
    evidenceEvents: Array.isArray(candidate.evidenceEvents)
      ? candidate.evidenceEvents
      : [],
    visitEvidence:
      candidate.visitEvidence && typeof candidate.visitEvidence === "object"
        ? candidate.visitEvidence
        : {},
  };
}

function projectMission(input: {
  missionId: string;
  taskId: string;
  title: string;
  briefing: string;
  payload: Day1TenDoorsPayload;
}): Day1TenDoorsMission {
  const payload = normaliseEvidence(input.payload);
  return {
    missionId: input.missionId,
    taskId: input.taskId,
    businessDate: DAY1_BUSINESS_DATE,
    title: input.title,
    briefing: input.briefing,
    targets: payload.targets,
    outcomes: payload.outcomes,
    currentTarget: day1CurrentTarget(payload),
    progressLabel: day1ProgressLabel(payload),
    visitedCount: day1VisitedCount(payload),
    totalCount: payload.targets.length,
    isComplete: day1IsComplete(payload),
    outcomeCounts: day1OutcomeCounts(payload),
    evidenceEvents: payload.evidenceEvents ?? [],
    visitEvidence: payload.visitEvidence ?? {},
  };
}

async function findExistingDay1Mission(input: {
  tenantId: string;
  driverId: string;
}): Promise<Day1TenDoorsMission | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const missions = await db
    .select()
    .from(openChannelMissions)
    .where(
      and(
        eq(openChannelMissions.tenantId, input.tenantId),
        eq(openChannelMissions.driverId, input.driverId),
        eq(openChannelMissions.businessDate, DAY1_BUSINESS_DATE),
        inArray(openChannelMissions.status, ["active", "completed"])
      )
    )
    .orderBy(desc(openChannelMissions.createdAt));
  for (const mission of missions) {
    const [task] = await db
      .select()
      .from(openChannelMissionTasks)
      .where(
        and(
          eq(openChannelMissionTasks.tenantId, input.tenantId),
          eq(openChannelMissionTasks.missionId, mission.id)
        )
      )
      .limit(1);
    if (!task) continue;
    const payload = decodeDay1Payload(task.detail);
    if (!payload) continue;
    return projectMission({
      missionId: mission.id,
      taskId: task.id,
      title: mission.title,
      briefing: mission.operatorBriefing,
      payload,
    });
  }
  return null;
}

async function loadWritableDay1Mission(input: {
  tenantId: string;
  driverId: string;
  missionId: string;
}) {
  await ensureOpenChannelTables();
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [mission] = await db
    .select()
    .from(openChannelMissions)
    .where(
      and(
        eq(openChannelMissions.tenantId, input.tenantId),
        eq(openChannelMissions.driverId, input.driverId),
        eq(openChannelMissions.id, input.missionId)
      )
    )
    .limit(1);
  if (!mission) throw new Error("Day 1 mission was not found");
  const [task] = await db
    .select()
    .from(openChannelMissionTasks)
    .where(
      and(
        eq(openChannelMissionTasks.tenantId, input.tenantId),
        eq(openChannelMissionTasks.missionId, mission.id)
      )
    )
    .limit(1);
  if (!task) throw new Error("Day 1 mission task was not found");
  const decoded = decodeDay1Payload(task.detail);
  if (!decoded) throw new Error("This mission is not a Day 1 Ten Doors mission");
  return { db, mission, task, payload: normaliseEvidence(decoded) };
}

function assertTarget(payload: Day1TenDoorsPayload, targetId: string) {
  if (!payload.targets.some(target => target.id === targetId)) {
    throw new Error("That building is not part of today's mission");
  }
}

async function writePayload(input: {
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
  tenantId: string;
  taskId: string;
  payload: EvidencePayload;
}) {
  await input.db
    .update(openChannelMissionTasks)
    .set({ detail: encodeDay1Payload(input.payload) })
    .where(
      and(
        eq(openChannelMissionTasks.tenantId, input.tenantId),
        eq(openChannelMissionTasks.id, input.taskId)
      )
    );
}

function blankVisit(targetId: string): Day1VisitEvidence {
  return {
    targetId,
    arrivalRecordedAt: null,
    arrivalSource: null,
    lat: null,
    lng: null,
    accuracyMeters: null,
    outcomeRecordedAt: null,
    outcomeSource: null,
    outcome: null,
    decisionMaker: null,
    followUpNeeded: null,
  };
}

/**
 * Idempotent per driver+businessDate: returns the SAME mission (same
 * targets, same recorded outcomes) on every call rather than regenerating
 * a fresh set — reopening or refreshing Goldline must never hand Adam a
 * different 10 buildings mid-route.
 */
export async function getOrCreateDay1TenDoorsMission(input: {
  tenantId: string;
  driverId: string;
}): Promise<Day1TenDoorsMission> {
  await ensureOpenChannelTables();
  const existing = await findExistingDay1Mission(input);
  if (existing) return existing;

  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const missionId = randomUUID();
  const taskId = randomUUID();
  const payload: EvidencePayload = {
    kind: "day1_ten_doors",
    targets: DAY1_TARGETS as unknown as Day1Target[],
    outcomes: {},
    evidenceEvents: [],
    visitEvidence: {},
  };
  const now = new Date();
  try {
    await db.transaction(async tx => {
      await tx.insert(openChannelMissions).values({
        id: missionId,
        tenantId: input.tenantId,
        driverId: input.driverId,
        businessDate: DAY1_BUSINESS_DATE,
        status: "active",
        title: DAY1_TITLE,
        operatorBriefing: DAY1_MISSION_LINE,
        transcript:
          "Operator-declared Day 1 rescue mission: visit 10 real, hand-verified apartment buildings across Koreatown, Silver Lake, and Echo Park and pitch Laundry Butler as a no-cost resident amenity.",
        generationSource: "deterministic_fallback",
        gapStartedAt: now,
        nextCommitmentAt: null,
        availableMinutes: null,
        currentLocationJson: null,
        requestId: randomUUID(),
        approvedAt: now,
      });
      await tx.insert(openChannelMissionTasks).values({
        id: taskId,
        tenantId: input.tenantId,
        missionId,
        position: 0,
        title: DAY1_TITLE,
        detail: encodeDay1Payload(payload),
        estimatedMinutes: 240,
        category: "sales",
        navigationQuery: null,
        status: "pending",
      });
    });
  } catch {
    const raced = await findExistingDay1Mission(input);
    if (raced) return raced;
    throw new Error("Day 1 mission could not be created");
  }

  return projectMission({
    missionId,
    taskId,
    title: DAY1_TITLE,
    briefing: DAY1_MISSION_LINE,
    payload,
  });
}

/**
 * Append lightweight, durable field evidence to the EXISTING task.detail
 * JSON. This is intentionally not a new event table. Arrival is evidence of
 * physical presence only; it never writes a sales outcome.
 */
export async function recordDay1TenDoorsEvidence(input: {
  tenantId: string;
  driverId: string;
  missionId: string;
} & Day1RecordEvidenceInput): Promise<Day1TenDoorsMission> {
  const { db, mission, task, payload } = await loadWritableDay1Mission(input);
  assertTarget(payload, input.targetId);

  const events = payload.evidenceEvents ?? [];
  if (events.some(event => event.id === input.eventId)) {
    return projectMission({
      missionId: mission.id,
      taskId: task.id,
      title: mission.title,
      briefing: mission.operatorBriefing,
      payload,
    });
  }

  const visits = payload.visitEvidence ?? {};
  const existingVisit = visits[input.targetId] ?? blankVisit(input.targetId);
  if (input.kind === "arrived" && existingVisit.arrivalRecordedAt) {
    return projectMission({
      missionId: mission.id,
      taskId: task.id,
      title: mission.title,
      briefing: mission.operatorBriefing,
      payload,
    });
  }

  const recordedAt = new Date().toISOString();
  const event: Day1EvidenceEvent = {
    id: input.eventId,
    targetId: input.targetId,
    kind: input.kind,
    recordedAt,
    source: input.source,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    accuracyMeters: input.accuracyMeters ?? null,
    decisionMaker: null,
    followUpNeeded: null,
    amountCents: input.amountCents ?? null,
  };

  const nextPayload: EvidencePayload = {
    ...payload,
    evidenceEvents: [...events, event],
    visitEvidence:
      input.kind === "arrived"
        ? {
            ...visits,
            [input.targetId]: {
              ...existingVisit,
              arrivalRecordedAt: recordedAt,
              arrivalSource: input.source,
              lat: input.lat ?? null,
              lng: input.lng ?? null,
              accuracyMeters: input.accuracyMeters ?? null,
            },
          }
        : visits,
  };

  await writePayload({
    db,
    tenantId: input.tenantId,
    taskId: task.id,
    payload: nextPayload,
  });

  return projectMission({
    missionId: mission.id,
    taskId: task.id,
    title: mission.title,
    briefing: mission.operatorBriefing,
    payload: nextPayload,
  });
}

/**
 * The ONE writer of a Day 1 outcome. GPS/arrival is context only — this is
 * only ever called from an explicit tap of I MADE THE PITCH or COULDN'T
 * REACH THEM, never from mere proximity. Idempotent: recording an outcome
 * for a target that already has one is a no-op unless the operator explicitly
 * supplies source=operator_backfill to attach truthful metadata to a legacy
 * outcome. Backfill timestamps mean "recorded now", never "this happened now".
 */
export async function recordDay1TenDoorsOutcome(input: {
  tenantId: string;
  driverId: string;
  missionId: string;
  targetId: string;
  outcome: Day1TargetOutcome;
  requestId?: string;
  decisionMaker?: Day1DecisionMakerStatus;
  followUpNeeded?: boolean;
  source?: Day1EvidenceSource;
}): Promise<Day1TenDoorsMission> {
  const { db, mission, task, payload } = await loadWritableDay1Mission(input);
  assertTarget(payload, input.targetId);

  const events = payload.evidenceEvents ?? [];
  const visits = payload.visitEvidence ?? {};
  const existingVisit = visits[input.targetId] ?? blankVisit(input.targetId);
  const existingOutcome = payload.outcomes[input.targetId];
  const source = input.source ?? "operator_confirmed";

  const mayBackfillLegacyOutcome =
    existingOutcome != null &&
    source === "operator_backfill" &&
    existingVisit.outcomeRecordedAt == null;

  if (existingOutcome != null && !mayBackfillLegacyOutcome) {
    return projectMission({
      missionId: mission.id,
      taskId: task.id,
      title: mission.title,
      briefing: mission.operatorBriefing,
      payload,
    });
  }

  const outcome = existingOutcome ?? input.outcome;
  const recordedAt = new Date().toISOString();
  const decisionMaker = input.decisionMaker ?? "not_recorded";
  const followUpNeeded = input.followUpNeeded ?? null;
  const eventId = input.requestId ?? randomUUID();
  const event: Day1EvidenceEvent = {
    id: eventId,
    targetId: input.targetId,
    kind: outcome === "pitched" ? "pitch_recorded" : "couldnt_reach_recorded",
    recordedAt,
    source,
    lat: null,
    lng: null,
    accuracyMeters: null,
    decisionMaker,
    followUpNeeded,
    amountCents: null,
  };

  const nextPayload: EvidencePayload = {
    ...payload,
    outcomes:
      existingOutcome == null
        ? { ...payload.outcomes, [input.targetId]: outcome }
        : payload.outcomes,
    evidenceEvents: events.some(candidate => candidate.id === eventId)
      ? events
      : [...events, event],
    visitEvidence: {
      ...visits,
      [input.targetId]: {
        ...existingVisit,
        outcomeRecordedAt: recordedAt,
        outcomeSource: source,
        outcome,
        decisionMaker,
        followUpNeeded,
      },
    },
  };

  await writePayload({
    db,
    tenantId: input.tenantId,
    taskId: task.id,
    payload: nextPayload,
  });

  if (day1IsComplete(nextPayload) && mission.status !== "completed") {
    const completedAt = new Date();
    await db
      .update(openChannelMissions)
      .set({ status: "completed", completedAt })
      .where(
        and(
          eq(openChannelMissions.tenantId, input.tenantId),
          eq(openChannelMissions.id, mission.id)
        )
      );
    await db
      .update(openChannelMissionTasks)
      .set({ status: "completed", completedAt })
      .where(
        and(
          eq(openChannelMissionTasks.tenantId, input.tenantId),
          eq(openChannelMissionTasks.id, task.id)
        )
      );
  }

  return projectMission({
    missionId: mission.id,
    taskId: task.id,
    title: mission.title,
    briefing: mission.operatorBriefing,
    payload: nextPayload,
  });
}
