import { and, asc, eq } from "drizzle-orm";
import { commercialMissionEvents } from "../../drizzle/schema";
import { getDb } from "../db";
import { getCommercialMission } from "./commercialMissionStore";

export const COMMERCIAL_MISSION_CALL_OUTCOMES = [
  "no_answer",
  "left_voicemail",
  "spoke",
  "visit_booked",
  "not_a_fit",
  "contact_unavailable",
] as const;

export type CommercialMissionCallOutcome =
  (typeof COMMERCIAL_MISSION_CALL_OUTCOMES)[number];

export type CommercialMissionCallAttempt = {
  id: number;
  missionId: number;
  outcome: CommercialMissionCallOutcome;
  notes: string;
  actorId: string;
  createdAt: string;
};

function callAttemptView(
  row: typeof commercialMissionEvents.$inferSelect
): CommercialMissionCallAttempt {
  const metadata = (row.metadataJson ?? {}) as Record<string, unknown>;
  const outcome = COMMERCIAL_MISSION_CALL_OUTCOMES.find(
    value => value === metadata.outcome
  );
  if (!outcome) throw new Error("Commercial mission call outcome is invalid");
  return {
    id: row.id,
    missionId: row.missionId,
    outcome,
    notes: typeof metadata.notes === "string" ? metadata.notes : "",
    actorId: row.actorId ?? "unknown",
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listCommercialMissionCallAttempts(input: {
  tenantId: string;
  missionId: number;
}): Promise<CommercialMissionCallAttempt[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(commercialMissionEvents)
    .where(
      and(
        eq(commercialMissionEvents.tenantId, input.tenantId),
        eq(commercialMissionEvents.missionId, input.missionId),
        eq(commercialMissionEvents.eventName, "cold_call_logged")
      )
    )
    .orderBy(asc(commercialMissionEvents.createdAt), asc(commercialMissionEvents.id));
  return rows.map(callAttemptView);
}

export async function recordCommercialMissionCallAttempt(input: {
  tenantId: string;
  missionId: number;
  actorId: string;
  requestId: string;
  outcome: CommercialMissionCallOutcome;
  notes: string;
}): Promise<CommercialMissionCallAttempt> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const idempotencyKey = `cold-call:${input.requestId}`;
  const mission = await getCommercialMission(input);
  if (!mission) throw new Error("Commercial mission not found");
  if (!["phone_ready", "preparing"].includes(mission.status)) {
    throw new Error(`Cold calls cannot be logged while the mission is ${mission.status}`);
  }

  await db
    .insert(commercialMissionEvents)
    .values({
      tenantId: input.tenantId,
      missionId: input.missionId,
      eventName: "cold_call_logged",
      fromStatus: mission.status,
      toStatus: mission.status,
      actorType: "driver",
      actorId: input.actorId,
      idempotencyKey,
      metadataJson: { outcome: input.outcome, notes: input.notes.trim() },
    })
    .onDuplicateKeyUpdate({ set: { idempotencyKey } });

  const [persisted] = await db
    .select()
    .from(commercialMissionEvents)
    .where(
      and(
        eq(commercialMissionEvents.tenantId, input.tenantId),
        eq(commercialMissionEvents.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);
  if (!persisted || persisted.missionId !== input.missionId) {
    throw new Error("Cold-call request ID is already bound to another mission");
  }
  return callAttemptView(persisted);
}
