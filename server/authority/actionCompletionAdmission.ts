import { and, eq } from "drizzle-orm";
import { commercialMissionEvents } from "../../drizzle/schema";
import { getDb } from "../db";
import {
  admitAuthorityClaimWith,
  type AuthorityReceipt,
  type AuthorityTransaction,
} from "./authorityReceipt";

const HUMAN_ACTORS = new Set(["operator", "driver", "human", "voice"]);

export async function admitCompletedCommercialVisit(input: {
  tenantId: string;
  missionId: number;
  evidenceReference: string;
}): Promise<AuthorityReceipt> {
  const match = /^commercial_mission_events:(\d+)$/.exec(
    input.evidenceReference.trim()
  );
  if (!match) {
    throw new Error(
      "action_completed requires a persisted commercial mission event reference"
    );
  }

  const eventId = Number(match[1]);
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [event] = await db
    .select({
      id: commercialMissionEvents.id,
      missionId: commercialMissionEvents.missionId,
      eventName: commercialMissionEvents.eventName,
      actorType: commercialMissionEvents.actorType,
      actorId: commercialMissionEvents.actorId,
      createdAt: commercialMissionEvents.createdAt,
    })
    .from(commercialMissionEvents)
    .where(
      and(
        eq(commercialMissionEvents.tenantId, input.tenantId),
        eq(commercialMissionEvents.id, eventId)
      )
    )
    .limit(1);

  if (!event) throw new Error("Completed action evidence event was not found");
  if (event.missionId !== input.missionId) {
    throw new Error("Completed action evidence belongs to another mission");
  }
  if (event.eventName !== "visit_completed") {
    throw new Error("action_completed requires a visit_completed mission event");
  }
  if (!HUMAN_ACTORS.has(event.actorType)) {
    throw new Error("System/model actors cannot attest completed field work");
  }

  return admitAuthorityClaimWith(db as unknown as AuthorityTransaction, {
    tenantId: input.tenantId,
    claimType: "action_completed",
    subjectType: "commercial_mission",
    subjectId: String(input.missionId),
    sourceType: "commercial_mission_event",
    sourceRef: input.evidenceReference.trim(),
    actorType: event.actorType,
    actorId: event.actorId,
    evidenceClass: "operator_attested",
    verificationClass: "ATTESTED",
    admissionPolicy: "commercial_visit_completion_v1",
    occurredAt: event.createdAt,
    metadata: { eventId },
  });
}
