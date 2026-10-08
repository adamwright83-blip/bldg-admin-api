import { and, eq } from "drizzle-orm";
import {
  commercialMissionEvents,
  commercialVisitOutcomes,
} from "../../../drizzle/schema";
import {
  PARKING_LOT_CLERK_EVENT_NAME,
  PARKING_LOT_CLERK_PROVENANCE,
} from "../../../shared/commercialMissionField";
import { getDb } from "../../db";
import {
  admitAuthorityClaimWith,
  type AuthorityReceipt,
  type AuthorityTransaction,
} from "./authorityReceipt";

const HUMAN_ACTORS = new Set(["operator", "driver", "human", "voice"]);

export type AdmittedFieldObservation = {
  receipt: AuthorityReceipt;
  observationText: string;
  visitOutcome: {
    outcome: string;
    notes: string | null;
    decisionMakerStatus: string;
    reason: string | null;
    quoteRequested: boolean;
    pilotRequested: boolean;
  };
};

export async function admitCommercialFieldObservation(input: {
  tenantId: string;
  missionId: number;
  evidenceReference: string;
}): Promise<AdmittedFieldObservation> {
  const match = /^commercial_mission_events:(\d+)$/.exec(
    input.evidenceReference.trim()
  );
  if (!match) {
    throw new Error(
      "field_observation_attested requires a persisted commercial mission event reference"
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
      metadataJson: commercialMissionEvents.metadataJson,
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

  if (!event) throw new Error("Field observation evidence event was not found");
  if (event.missionId !== input.missionId) {
    throw new Error("Field observation evidence belongs to another mission");
  }
  if (event.eventName !== PARKING_LOT_CLERK_EVENT_NAME) {
    throw new Error(
      "field_observation_attested requires a parking-lot Clerk observation event"
    );
  }
  if (!HUMAN_ACTORS.has(event.actorType) || !event.actorId?.trim()) {
    throw new Error("System/model or anonymous actors cannot attest field observations");
  }

  const metadata =
    event.metadataJson &&
    typeof event.metadataJson === "object" &&
    !Array.isArray(event.metadataJson)
      ? (event.metadataJson as Record<string, unknown>)
      : {};
  const observationText =
    typeof metadata.text === "string" ? metadata.text.trim() : "";
  const visitOutcomeId =
    typeof metadata.visitOutcomeId === "number" && Number.isInteger(metadata.visitOutcomeId)
      ? metadata.visitOutcomeId
      : typeof metadata.visitOutcomeId === "string" && /^\d+$/.test(metadata.visitOutcomeId.trim())
        ? Number(metadata.visitOutcomeId.trim())
        : 0;
  if (
    !observationText ||
    metadata.provenance !== PARKING_LOT_CLERK_PROVENANCE ||
    visitOutcomeId <= 0
  ) {
    throw new Error(
      "Field observation event lacks durable operator testimony provenance"
    );
  }

  const [visitOutcome] = await db
    .select({
      id: commercialVisitOutcomes.id,
      missionId: commercialVisitOutcomes.missionId,
      recordedBy: commercialVisitOutcomes.recordedBy,
      outcome: commercialVisitOutcomes.outcome,
      notes: commercialVisitOutcomes.notes,
      decisionMakerStatus: commercialVisitOutcomes.decisionMakerStatus,
      reason: commercialVisitOutcomes.reason,
      quoteRequested: commercialVisitOutcomes.quoteRequested,
      pilotRequested: commercialVisitOutcomes.pilotRequested,
    })
    .from(commercialVisitOutcomes)
    .where(
      and(
        eq(commercialVisitOutcomes.tenantId, input.tenantId),
        eq(commercialVisitOutcomes.id, visitOutcomeId)
      )
    )
    .limit(1);
  if (
    !visitOutcome ||
    visitOutcome.missionId !== input.missionId ||
    visitOutcome.recordedBy !== event.actorId
  ) {
    throw new Error(
      "Field observation testimony is not bound to its persisted visit outcome"
    );
  }

  const receipt = await admitAuthorityClaimWith(
    db as unknown as AuthorityTransaction,
    {
      tenantId: input.tenantId,
      claimType: "field_observation_attested",
      subjectType: "commercial_mission",
      subjectId: String(input.missionId),
      sourceType: "commercial_mission_event",
      sourceRef: input.evidenceReference.trim(),
      actorType: event.actorType,
      actorId: event.actorId,
      evidenceClass: "operator_attested",
      verificationClass: "ATTESTED",
      admissionPolicy: "commercial_field_observation_v1",
      occurredAt: event.createdAt,
      metadata: {
        eventId,
        visitOutcomeId,
        provenance: PARKING_LOT_CLERK_PROVENANCE,
      },
    }
  );

  return {
    receipt,
    observationText,
    visitOutcome: {
      outcome: visitOutcome.outcome,
      notes: visitOutcome.notes,
      decisionMakerStatus: visitOutcome.decisionMakerStatus,
      reason: visitOutcome.reason,
      quoteRequested: Boolean(visitOutcome.quoteRequested),
      pilotRequested: Boolean(visitOutcome.pilotRequested),
    },
  };
}
