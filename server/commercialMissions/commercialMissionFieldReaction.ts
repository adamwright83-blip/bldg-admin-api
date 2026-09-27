import {
  evaluateCommercialMissionLocationCheckIn,
} from "@shared/commercialMissionField";
import { appendGoldlineWorldEvent } from "../goldlineWorld/worldEventStore";
import { findPhysicalEntityIdByAddress } from "../goldlineWorld/entityLookup";
import {
  issueCommercialPhysicalFirstVisitReceipt,
} from "../goldlineVerification/commercialFieldVisitProducer";
import {
  ingestVerifiedGoldlineOutcomeBestEffort,
} from "../goldlineVerification/ingestVerifiedGoldlineOutcome";
import { createDrizzleNarratorStore } from "../narratorOs/drizzleStore";
import { initNarratorOperator } from "../narratorOs/init";
import { advanceNarratorAfterVerifiedOutcome } from "../narratorOs/advanceAfterVerifiedOutcome";
import {
  createDrizzleNarratorPresentationStore,
} from "../narratorOs/presentationDrizzleStore";
import {
  preparePlayerPresentationForOccurrence,
} from "../narratorOs/presentationStore";
import type { PlayerPresentationPayload } from "../narratorOs/playerPresentation";

type CompletedCommercialVisitState = {
  mission: {
    id: number;
    account: {
      accountId: number;
      providerAccountId?: string | null;
      name: string;
      address: string;
      latitude: number | null;
      longitude: number | null;
    };
  };
  field: {
    checkInMethod: "location" | "manual" | null;
    latitude: number | null;
    longitude: number | null;
    locationAccuracyMeters: number | null;
  } | null;
  visitOutcome: {
    id: number;
    outcome: string;
    createdAt: string | null;
  } | null;
};

export type CommercialVisitReactionResult = {
  readonly worldEventId: string | null;
  readonly narratorReceiptId: string | null;
  readonly narratorBeatId: string | null;
  readonly playerPayload: PlayerPresentationPayload | null;
  readonly locationAuthority:
    | "property_radius_verified"
    | "operator_attested";
  readonly errors: readonly string[];
};

function verifiedLocationEvidence(state: CompletedCommercialVisitState) {
  const field = state.field;
  if (
    field?.checkInMethod !== "location" ||
    field.latitude == null ||
    field.longitude == null ||
    field.locationAccuracyMeters == null
  ) {
    return null;
  }
  const decision = evaluateCommercialMissionLocationCheckIn({
    propertyLatitude: state.mission.account.latitude,
    propertyLongitude: state.mission.account.longitude,
    latitude: field.latitude,
    longitude: field.longitude,
    accuracyMeters: field.locationAccuracyMeters,
  });
  if (!decision.accepted) return null;
  return {
    distanceMeters: decision.distanceMeters,
    accuracyMeters: field.locationAccuracyMeters,
  };
}

/**
 * Projects a completed commercial visit into Goldline world state and,
 * only when property-radius presence is re-proven from persisted state,
 * into Narrator eligibility. Business truth has already committed before
 * this function runs; downstream failures never roll it back.
 */
export async function reactToCompletedCommercialVisit(input: {
  tenantId: string;
  operatorUserId: string;
  state: CompletedCommercialVisitState;
}): Promise<CommercialVisitReactionResult> {
  const errors: string[] = [];
  const outcome = input.state.visitOutcome;
  if (!outcome?.createdAt) {
    return {
      worldEventId: null,
      narratorReceiptId: null,
      narratorBeatId: null,
      playerPayload: null,
      locationAuthority: "operator_attested",
      errors: ["visit_outcome_missing"],
    };
  }

  const verifiedLocation = verifiedLocationEvidence(input.state);
  const locationAuthority = verifiedLocation
    ? ("property_radius_verified" as const)
    : ("operator_attested" as const);
  const sourceReference = `commercial_visit_outcome:${outcome.id}`;

  let worldEventId: string | null = null;
  try {
    const physicalEntityId = await findPhysicalEntityIdByAddress({
      tenantId: input.tenantId,
      address: input.state.mission.account.address,
    });
    const worldEvent = await appendGoldlineWorldEvent({
      tenantId: input.tenantId,
      physicalEntityId,
      eventType: "visited",
      classification: "action",
      actorType: "field",
      actorId: input.operatorUserId,
      occurredAt: outcome.createdAt,
      observedAt: outcome.createdAt,
      sourceType: "commercial_visit_outcome",
      sourceId: String(outcome.id),
      sourceEvidenceReference: sourceReference,
      provenanceClass: verifiedLocation ? "device_location" : "operator_reported",
      verificationClass: "ATTESTED",
      confidence: verifiedLocation ? "high" : "medium",
      idempotencyKey: `commercial-field-visited:${input.tenantId}:${outcome.id}`,
      correlationId: `commercial-mission:${input.state.mission.id}:visit-outcome:${outcome.id}`,
      metadata: {
        missionId: input.state.mission.id,
        accountId: input.state.mission.account.accountId,
        googlePlaceId: input.state.mission.account.providerAccountId ?? null,
        propertyName: input.state.mission.account.name,
        outcome: outcome.outcome,
        checkInMethod: input.state.field?.checkInMethod ?? null,
        locationAuthority,
        propertyDistanceMeters: verifiedLocation?.distanceMeters ?? null,
        locationAccuracyMeters: verifiedLocation?.accuracyMeters ?? null,
      },
    });
    worldEventId = worldEvent.id;
  } catch (error) {
    errors.push(
      `world:${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!verifiedLocation) {
    return {
      worldEventId,
      narratorReceiptId: null,
      narratorBeatId: null,
      playerPayload: null,
      locationAuthority,
      errors,
    };
  }

  try {
    const targetId =
      input.state.mission.account.providerAccountId?.trim() ||
      `commercial_account:${input.state.mission.account.accountId}`;
    const receipt = issueCommercialPhysicalFirstVisitReceipt({
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      missionId: input.state.mission.id,
      visitOutcomeId: outcome.id,
      targetId,
      occurredAt: outcome.createdAt,
      checkInMethod: "location",
      locationAuthority: "property_radius_verified",
      propertyDistanceMeters: verifiedLocation.distanceMeters,
      locationAccuracyMeters: verifiedLocation.accuracyMeters,
    });

    const scope = {
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
    };
    const store = createDrizzleNarratorStore();
    await initNarratorOperator(store, scope);
    const ingest = await ingestVerifiedGoldlineOutcomeBestEffort({
      store,
      scope,
      receipt,
    });
    if (!ingest.recorded) {
      errors.push(`narrator_ingest:${ingest.reason}`);
      return {
        worldEventId,
        narratorReceiptId: receipt.receiptId,
        narratorBeatId: null,
        playerPayload: null,
        locationAuthority,
        errors,
      };
    }

    const advance = await advanceNarratorAfterVerifiedOutcome({
      store,
      scope,
      verifiedGoldline: [receipt],
      nowMs: Date.parse(outcome.createdAt),
      nowIso: outcome.createdAt,
    });
    if (advance.narrationFailed) {
      errors.push(`narrator:${advance.failureReason ?? "unknown"}`);
    }
    if (advance.presentation?.occurrenceLedgerEntryId) {
      const snapshot = await store.load(scope);
      if (snapshot) {
        await preparePlayerPresentationForOccurrence({
          presentationStore: createDrizzleNarratorPresentationStore(),
          snapshot,
          occurrenceLedgerEntryId: advance.presentation.occurrenceLedgerEntryId,
          nowIso: outcome.createdAt,
        });
      }
    }
    return {
      worldEventId,
      narratorReceiptId: receipt.receiptId,
      narratorBeatId: advance.presentation?.beatId ?? null,
      playerPayload: advance.playerPayload,
      locationAuthority,
      errors,
    };
  } catch (error) {
    errors.push(
      `narrator:${error instanceof Error ? error.message : String(error)}`
    );
    return {
      worldEventId,
      narratorReceiptId: null,
      narratorBeatId: null,
      playerPayload: null,
      locationAuthority,
      errors,
    };
  }
}
