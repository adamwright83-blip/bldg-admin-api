import { and, asc, eq } from "drizzle-orm";
import { commercialMissionEvents } from "../../drizzle/schema";
import { getDb } from "../db";
import {
  assertMissionConversationOutcome,
  type ConnectedCallTransportEvidence,
} from "../salesCalls";
import { getCommercialMission } from "./commercialMissionStore";
import { awardDriverSalesPoints } from "./driverSalesMotivationService";

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
  transportEvidence: ConnectedCallTransportEvidence | null;
};

function transportEvidenceFromMetadata(
  metadata: Record<string, unknown>
): ConnectedCallTransportEvidence | null {
  const raw = metadata.transportEvidence;
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.tenantId !== "string") return null;
  if (typeof value.missionId !== "number") return null;
  if (typeof value.coldCallTargetId !== "string" || !value.coldCallTargetId) return null;
  if (typeof value.salesCallAttemptId !== "number") return null;
  const prospectLegCallSid = value.prospectLegCallSid;
  if (prospectLegCallSid != null && typeof prospectLegCallSid !== "string") return null;
  return {
    tenantId: value.tenantId,
    missionId: value.missionId,
    coldCallTargetId: value.coldCallTargetId,
    salesCallAttemptId: value.salesCallAttemptId,
    prospectLegCallSid: prospectLegCallSid ?? null,
  };
}

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
    transportEvidence: transportEvidenceFromMetadata(metadata),
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

async function awardLoggedColdCall(input: {
  tenantId: string;
  missionId: number;
  actorId: string;
  requestId: string;
  outcome: CommercialMissionCallOutcome;
}) {
  const attempts = await listCommercialMissionCallAttempts({
    tenantId: input.tenantId,
    missionId: input.missionId,
  });
  const activityPoints = attempts.length <= 1 ? 4 : attempts.length === 2 ? 2 : 1;
  const outcomeBonus: Partial<Record<CommercialMissionCallOutcome, number>> = {
    spoke: 6,
    visit_booked: 18,
  };
  await awardDriverSalesPoints({
    tenantId: input.tenantId,
    driverId: input.actorId,
    missionId: input.missionId,
    eventType: "cold_call_completed",
    points: activityPoints + (outcomeBonus[input.outcome] ?? 0),
    dedupeKey: `score:cold-call:${input.requestId}`,
    metadata: { outcome: input.outcome },
  });
}

export async function recordCommercialMissionCallAttempt(input: {
  tenantId: string;
  missionId: number;
  actorId: string;
  requestId: string;
  outcome: CommercialMissionCallOutcome;
  notes: string;
  /**
   * Cold Call Burst names the target. The latest attempt on that target is
   * the one whose prospect leg must have connected.
   */
  coldCallTargetId?: string;
  /**
   * Legacy log names the sales_call_attempts row. Required for spoke and
   * visit_booked when no target is named. The mission's latest attempt is
   * not a substitute.
   */
  salesCallAttemptId?: number;
}): Promise<CommercialMissionCallAttempt> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const idempotencyKey = `cold-call:${input.requestId}`;
  const mission = await getCommercialMission(input);
  if (!mission) throw new Error("Commercial mission not found");
  if (!["phone_ready", "preparing"].includes(mission.status)) {
    throw new Error(`Cold calls cannot be logged while the mission is ${mission.status}`);
  }

  const [existing] = await db
    .select()
    .from(commercialMissionEvents)
    .where(
      and(
        eq(commercialMissionEvents.tenantId, input.tenantId),
        eq(commercialMissionEvents.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);
  if (existing) {
    if (existing.missionId !== input.missionId) {
      throw new Error("Cold-call request ID is already bound to another mission");
    }
    const view = callAttemptView(existing);
    await awardLoggedColdCall({ ...input, outcome: view.outcome });
    return view;
  }

  const transportEvidence = await assertMissionConversationOutcome({
    tenantId: input.tenantId,
    missionId: input.missionId,
    coldCallTargetId: input.coldCallTargetId,
    salesCallAttemptId: input.salesCallAttemptId,
    outcome: input.outcome,
  });

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
      metadataJson: {
        outcome: input.outcome,
        notes: input.notes.trim(),
        ...(transportEvidence ? { transportEvidence } : {}),
      },
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
  const view = callAttemptView(persisted);
  await awardLoggedColdCall({ ...input, outcome: view.outcome });
  return view;
}
