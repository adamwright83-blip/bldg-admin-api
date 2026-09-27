import { issueVerifiedGoldlineReceiptFromAuthoritativeMutation } from "./issueVerifiedGoldlineReceipt";
import { commercialFieldVisitProducerCapability } from "./producerCapability";
import type { VerifiedGoldlineReceipt } from "../narratorOs/verifiedGoldlineReceipt";

export const COMMERCIAL_FIELD_VISIT_PRODUCER_NAMESPACE =
  "commercial_mission_field_visit_v1" as const;

export type PersistedCommercialPhysicalVisitEvidence = {
  readonly tenantId: string;
  readonly operatorUserId: string;
  readonly missionId: number;
  readonly visitOutcomeId: number;
  readonly targetId: string;
  readonly occurredAt: string;
  readonly checkInMethod: "location";
  readonly locationAuthority: "property_radius_verified";
  readonly propertyDistanceMeters: number;
  readonly locationAccuracyMeters: number;
};

/**
 * Converts an already-persisted, server-validated commercial visit into the
 * single Narrator outcome this producer is allowed to issue.
 *
 * The caller must derive this structure from stored mission/field/outcome
 * rows after the business transaction commits. Manual arrival is deliberately
 * not representable here.
 */
export function issueCommercialPhysicalFirstVisitReceipt(
  evidence: PersistedCommercialPhysicalVisitEvidence
): VerifiedGoldlineReceipt {
  if (
    !Number.isInteger(evidence.visitOutcomeId) ||
    evidence.visitOutcomeId <= 0 ||
    !Number.isInteger(evidence.missionId) ||
    evidence.missionId <= 0
  ) {
    throw new Error("Commercial field visit requires persisted numeric identities");
  }
  if (
    evidence.checkInMethod !== "location" ||
    evidence.locationAuthority !== "property_radius_verified"
  ) {
    throw new Error("Commercial field visit is not property-radius verified");
  }
  if (
    !Number.isFinite(evidence.propertyDistanceMeters) ||
    evidence.propertyDistanceMeters < 0 ||
    !Number.isFinite(evidence.locationAccuracyMeters) ||
    evidence.locationAccuracyMeters < 0
  ) {
    throw new Error("Commercial field visit location evidence is invalid");
  }
  const occurredAtMs = Date.parse(evidence.occurredAt);
  if (!Number.isFinite(occurredAtMs)) {
    throw new Error("Commercial field visit occurrence time is invalid");
  }

  return issueVerifiedGoldlineReceiptFromAuthoritativeMutation({
    producer: commercialFieldVisitProducerCapability(),
    mutation: {
      sourceEventId: `commercial_visit_outcome:${evidence.visitOutcomeId}`,
      tenantId: evidence.tenantId,
      operatorUserId: evidence.operatorUserId,
      outcomeId: "physical_first_visit",
      occurredAtMs,
      targetId: evidence.targetId,
      evidenceClass: "operator_attested",
      evidenceRef: {
        sourceType: "commercial_visit_outcome",
        sourceReference: `commercial_visit_outcome:${evidence.visitOutcomeId}`,
        classification: "operator_attested",
      },
      sourceVerificationClass: "ATTESTED",
    },
  });
}
