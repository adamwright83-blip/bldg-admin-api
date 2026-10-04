import { describe, expect, it } from "vitest";
import { projectPhysicalWorldState, type GoldlineWorldEvent } from "./goldlineWorld";

function won(overrides: Partial<GoldlineWorldEvent> = {}): GoldlineWorldEvent {
  return {
    id: "win-1",
    tenantId: "tenant-1",
    physicalEntityId: "building-1",
    eventType: "account_won",
    classification: "outcome",
    actorType: "operator",
    actorId: "adam",
    occurredAt: "2026-10-04T18:00:00.000Z",
    observedAt: null,
    sourceType: "commercial_pipeline",
    sourceId: "mission-7",
    sourceEvidenceReference: "pipeline-resolution:req-1",
    provenanceClass: "operator_reported",
    verificationClass: "ATTESTED",
    confidence: "high",
    idempotencyKey: "world-win-1",
    correlationId: "mission-7",
    metadata: {},
    ...overrides,
  };
}

describe("Goldline account-win authority", () => {
  it("does not project won from an outcome row without an authority receipt marker", () => {
    const state = projectPhysicalWorldState({
      physicalEntityId: "building-1",
      events: [won()],
      residentCount: 0,
      activeResidentCount: 0,
      epistemicState: "confirmed",
    });
    expect(state.commercialState).toBe("none");
  });

  it("projects won only when the admitted receipt marker and trusted verification class are present", () => {
    const state = projectPhysicalWorldState({
      physicalEntityId: "building-1",
      events: [
        won({
          metadata: { authorityReceiptId: "auth-123" },
          verificationClass: "ATTESTED",
        }),
      ],
      residentCount: 0,
      activeResidentCount: 0,
      epistemicState: "confirmed",
    });
    expect(state.commercialState).toBe("won");
  });

  it("does not accept a CLAIMED win even if a caller supplies a receipt-looking marker", () => {
    const state = projectPhysicalWorldState({
      physicalEntityId: "building-1",
      events: [
        won({
          metadata: { authorityReceiptId: "auth-123" },
          verificationClass: "CLAIMED",
        }),
      ],
      residentCount: 0,
      activeResidentCount: 0,
      epistemicState: "confirmed",
    });
    expect(state.commercialState).toBe("none");
  });
});
