import { describe, expect, it } from "vitest";
import { deriveDaphneRelationship } from "./relationshipModel";
import type { DaphneObservationRecord } from "./observationStore";

function rel(id: string, agentId: string, eventKind: string, value: string): DaphneObservationRecord {
  return {
    id, tenantId: "t", canonicalOperatorId: "o", operatorUserId: "1",
    sessionId: "s", actorType: "user", actorId: "1", agentId,
    observationKind: "relationship_event", evidenceChannel: "stated",
    verificationStatus: "attested", sourceType: "conversation", sourceReference: id,
    occurredAt: `2026-10-07T08:00:0${id.slice(-1)}.000Z`,
    context: null, payload: { eventKind, value }, metadata: null,
    idempotencyKey: id, createdAt: "2026-10-07T08:01:00.000Z",
  };
}

describe("Daphne V2 dyadic Relationship", () => {
  it("does not leak one agent's relationship history into another", () => {
    const value = deriveDaphneRelationship({
      observations: [
        rel("e1", "claire", "correction", "Do not repeat the same question."),
        rel("e2", "mitch", "preference", "Show visual proofs."),
      ],
      agentId: "claire",
      asOf: new Date("2026-10-07T09:00:00Z"),
    });
    expect(value.corrections).toEqual(["Do not repeat the same question."]);
    expect(value.preferences).toEqual([]);
    expect(value.sourceObservationIds).toEqual(["e1"]);
  });

  it("tracks rupture and repair without pretending repair erases history", () => {
    const value = deriveDaphneRelationship({
      observations: [
        rel("e1", "claire", "rupture", "repeated-question"),
        rel("e2", "claire", "repair", "repeated-question"),
      ],
      agentId: "claire",
      asOf: new Date("2026-10-07T09:00:00Z"),
    });
    expect(value.repairs).toContain("repeated-question");
    expect(value.unresolvedRuptures).toEqual([]);
    expect(value.sourceObservationIds).toEqual(["e1", "e2"]);
  });
});
