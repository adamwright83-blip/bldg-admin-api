import {
  BUSINESS_OUTCOMES_NOT_IMPLIED_BY_COMMUNICATIONS,
  type BusinessOutcomeNotImpliedByCommunications,
  type CommunicationCandidateEvidence,
  type CommunicationEvidenceConcept,
  type TwilioCommunicationReceipt,
  providerSidIsGoldlineEntityId,
} from "@shared/twilioPlatform";

/**
 * Pure mapper from a provider receipt to communications evidence.
 * MESSAGE_FAILED is a receipt only. It is not an evidence concept and
 * it is not a Goldline business outcome.
 */

const CALL_EVENTS = new Set<TwilioCommunicationReceipt["eventType"]>([
  "CALL_ATTEMPTED",
  "CALL_RINGING",
  "CALL_CONNECTED",
  "CALL_COMPLETED",
  "CALL_NO_ANSWER",
  "CALL_BUSY",
  "CALL_FAILED",
  "VOICEMAIL_DETECTED",
]);

function primaryConcept(
  eventType: TwilioCommunicationReceipt["eventType"]
): CommunicationEvidenceConcept | null {
  if (eventType === "MESSAGE_FAILED") return null;
  return eventType;
}

function conceptsFor(receipt: TwilioCommunicationReceipt): CommunicationEvidenceConcept[] {
  const primary = primaryConcept(receipt.eventType);
  if (!primary) return [];
  const concepts: CommunicationEvidenceConcept[] = [primary];
  const duration = receipt.durationSeconds;
  if (
    CALL_EVENTS.has(receipt.eventType) &&
    typeof duration === "number" &&
    Number.isFinite(duration)
  ) {
    concepts.push("CALL_DURATION_OBSERVED");
  }
  return concepts;
}

function observedAt(receipt: TwilioCommunicationReceipt): string {
  return receipt.completedAt ?? receipt.answeredAt ?? receipt.startedAt ?? receipt.createdAt;
}

export function toCommunicationCandidateEvidence(
  receipt: TwilioCommunicationReceipt
): CommunicationCandidateEvidence[] {
  return conceptsFor(receipt).map(concept => {
    const callSid = receipt.callSid;
    const messageSid = receipt.messageSid;
    if (providerSidIsGoldlineEntityId(callSid) || providerSidIsGoldlineEntityId(messageSid)) {
      throw new Error("provider SID was treated as a Goldline entity id");
    }
    return {
      kind: "communications_evidence",
      concept,
      tenantId: receipt.tenantId,
      operatorUserId: receipt.operatorUserId,
      provider: "twilio",
      providerEventId: receipt.providerEventId,
      callSid,
      parentCallSid: receipt.parentCallSid,
      messageSid,
      direction: receipt.direction,
      durationSeconds: concept === "CALL_DURATION_OBSERVED" ? receipt.durationSeconds : null,
      observedAt: observedAt(receipt),
      sourceIdempotencyKey: receipt.idempotencyKey,
      goldlineEntityId: null,
    };
  });
}

export function communicationEvidenceImpliesBusinessOutcome(
  _evidence: CommunicationCandidateEvidence
): false {
  return false;
}

export function communicationsEvidenceContainsBusinessOutcome(
  evidence: readonly CommunicationCandidateEvidence[]
): BusinessOutcomeNotImpliedByCommunications | null {
  const serialized = JSON.stringify(evidence);
  for (const outcome of BUSINESS_OUTCOMES_NOT_IMPLIED_BY_COMMUNICATIONS) {
    if (serialized.includes(outcome)) return outcome;
  }
  return null;
}
