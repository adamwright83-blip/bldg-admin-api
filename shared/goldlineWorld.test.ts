import { describe, expect, it } from "vitest";
import {
  celebrationForEvent,
  deriveAttentionReasons,
  deriveEpistemicState,
  projectPhysicalWorldState,
  type GoldlineWorldEvent,
} from "./goldlineWorld";

const event = (
  eventType: string,
  classification: GoldlineWorldEvent["classification"],
  id = eventType
): GoldlineWorldEvent => ({
  id,
  tenantId: "default",
  physicalEntityId: "building-1",
  eventType,
  classification,
  actorType: "field",
  actorId: "driver-1",
  occurredAt: "2026-08-31T12:00:00.000Z",
  observedAt: null,
  sourceType: "test_fixture",
  sourceId: id,
  sourceEvidenceReference: `test:${id}`,
  provenanceClass: "existing_business_record",
  verificationClass: "VERIFIED",
  confidence: "high",
  idempotencyKey: id,
  correlationId: "correlation-1",
  metadata: {},
});

describe("truth-bound physical world projection", () => {
  it("keeps action history distinct from outcome state", () => {
    const projected = projectPhysicalWorldState({
      physicalEntityId: "building-1",
      events: [event("visited", "action"), event("proposal_sent", "action")],
      residentCount: 1,
      activeResidentCount: 0,
      epistemicState: "confirmed",
    });
    expect(projected.commercialState).toBe("pursued");
    expect(projected.historyMarks.map(mark => mark.semantic).sort()).toEqual(["proposal_sent", "visited"]);
    expect(projected.illumination).toBe("dim");
  });

  it("does not let outreach relight a dormant resident", () => {
    const attempted = projectPhysicalWorldState({
      physicalEntityId: "building-1",
      events: [event("recovery_outreach_completed", "action")],
      residentCount: 1,
      activeResidentCount: 0,
      epistemicState: "confirmed",
    });
    expect(attempted.recoveryState).toBe("attempted");
    expect(attempted.illumination).toBe("dim");

    const recovered = projectPhysicalWorldState({
      physicalEntityId: "building-1",
      events: [
        event("recovery_outreach_completed", "action"),
        event("customer_recovered", "outcome"),
      ],
      residentCount: 1,
      activeResidentCount: 1,
      epistemicState: "confirmed",
    });
    expect(recovered.recoveryState).toBe("recovered");
    expect(recovered.illumination).toBe("active");
  });

  it("rejects an action mislabeled as an outcome", () => {
    const projected = projectPhysicalWorldState({
      physicalEntityId: "building-1",
      events: [event("proposal_sent", "outcome")],
      residentCount: 0,
      activeResidentCount: 0,
      epistemicState: "unknown",
    });
    expect(projected.commercialState).toBe("none");
    expect(projected.historyMarks).toEqual([]);
  });
});

describe("epistemic and attention projections", () => {
  it("does not accept viewing state as an uncertainty input", () => {
    expect(deriveEpistemicState({
      hasConfirmedEvidence: false,
      hasConflict: true,
      hasInference: false,
      hasForecastPressure: false,
    })).toBe("conflicting");
  });

  it("explains every attention reason from evidence", () => {
    const reasons = deriveAttentionReasons({
      overdueFollowUp: { dueAt: "2026-08-30", source: "follow-up:1" },
      residentCount: { count: 4, source: "customer-cluster:1" },
    });
    expect(reasons).toHaveLength(2);
    expect(reasons.every(reason => reason.explanation && reason.sourceEvidenceReference)).toBe(true);
  });
});

describe("celebration truth boundaries", () => {
  it("separates journal, accepted visit, and recovery outcome payoffs", () => {
    expect(celebrationForEvent(event("field_journal_saved", "action"))?.label).toBe("FIELD INTEL SECURED");
    expect(celebrationForEvent(event("visited", "action"))?.label).toBe("YOU SHOWED UP");
    expect(celebrationForEvent(event("customer_recovered", "outcome"))?.label).toBe("LANTERN RELIT");
  });
});
