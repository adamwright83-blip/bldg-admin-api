import { describe, expect, it } from "vitest";
import type { GoldlineWorldEvent } from "./goldlineWorld";
import {
  deriveTerritoryState,
  stableTerritoryKey,
  territoryGameEventContract,
  viewingCannotAdvance,
  type TerritoryDefinition,
} from "./goldlineTerritories";

const definition: TerritoryDefinition = {
  id: "territory-1",
  tenantId: "default",
  stableKey: stableTerritoryKey({
    tenantId: "default",
    grammar: "visit_hunt",
    physicalEntityIds: ["b1", "b2", "b3"],
  }),
  version: 1,
  fantasyTitle: "The Three Doors",
  realGeographyLabel: "La Cienega",
  grammar: "visit_hunt",
  guardianId: "thunder_king",
  members: [
    { physicalEntityId: "b1", requiredAction: "visited", order: 0, sourceReason: "visit" },
    { physicalEntityId: "b2", requiredAction: "visited", order: 1, sourceReason: "visit" },
    { physicalEntityId: "b3", requiredAction: "visited", order: 2, sourceReason: "visit" },
  ],
  geometryMode: "cluster",
  createdFrom: "territory_compiler",
  publishedAt: "2026-09-01T00:00:00.000Z",
  classification: "game_projection",
};

const event = (
  overrides: Partial<GoldlineWorldEvent> & Pick<GoldlineWorldEvent, "id" | "eventType" | "physicalEntityId">
): GoldlineWorldEvent => ({
  tenantId: "default",
  classification: "action",
  actorType: "field",
  actorId: "driver-1",
  occurredAt: "2026-09-01T12:00:00.000Z",
  observedAt: null,
  sourceType: "test_fixture",
  sourceId: overrides.id,
  sourceEvidenceReference: `test:${overrides.id}`,
  provenanceClass: "operator_observed",
  verificationClass: "VERIFIED",
  confidence: "high",
  idempotencyKey: overrides.id,
  correlationId: "c1",
  metadata: {},
  ...overrides,
});

describe("territory progress is derived from chronicle, not a stored counter", () => {
  it("does not advance when the player only looks", () => {
    const state = deriveTerritoryState({ definition, events: [] });
    expect(state.readiness).toBe("veiled");
    expect(state.completedMemberIds).toEqual([]);
    expect(viewingCannotAdvance(state)).toBe(true);
  });

  it("reveals only the member that actually has visit evidence", () => {
    const state = deriveTerritoryState({
      definition,
      events: [event({ id: "v1", eventType: "visited", physicalEntityId: "b1" })],
    });
    expect(state.completedMemberIds).toEqual(["b1"]);
    expect(state.remainingMemberIds).toEqual(["b2", "b3"]);
    expect(state.readiness).toBe("in_progress");
    expect(state.confrontationReady).toBe(false);
  });

  it("ignores game-projection combat as if it never happened", () => {
    const state = deriveTerritoryState({
      definition,
      events: [
        event({
          id: "fake",
          eventType: "guardian_defeated",
          physicalEntityId: "b1",
          classification: "game_projection",
          provenanceClass: "generated_game_fiction",
          metadata: { territoryId: "territory-1" },
        }),
      ],
    });
    expect(state.completedMemberIds).toEqual([]);
    expect(state.cleared).toBe(true);
    expect(state.readiness).toBe("cleared");
  });

  it("becomes confrontation-ready only when every configured action exists", () => {
    const state = deriveTerritoryState({
      definition,
      events: [
        event({ id: "v1", eventType: "visited", physicalEntityId: "b1" }),
        event({ id: "v2", eventType: "visit_attempted", physicalEntityId: "b2" }),
        event({ id: "v3", eventType: "visited", physicalEntityId: "b3" }),
      ],
    });
    expect(state.confrontationReady).toBe(true);
    expect(state.readiness).toBe("confrontation_ready");
  });

  it("does not treat contact as a visit-hunt completion", () => {
    const state = deriveTerritoryState({
      definition,
      events: [event({ id: "c1", eventType: "call_completed", physicalEntityId: "b1" })],
    });
    expect(state.completedMemberIds).toEqual([]);
  });

  it("keeps cleared game history if later evidence is revised", () => {
    const state = deriveTerritoryState({
      definition,
      events: [
        event({
          id: "clear",
          eventType: "territory_cleared",
          physicalEntityId: null,
          classification: "game_projection",
          provenanceClass: "generated_game_fiction",
          metadata: { territoryId: "territory-1" },
        }),
      ],
    });
    expect(state.cleared).toBe(true);
    expect(state.evidenceRevisedAfterClear).toBe(true);
    expect(state.remainingMemberIds).toEqual(["b1", "b2", "b3"]);
  });
});

describe("territory game events cannot pretend to be business truth", () => {
  it("rejects a guardian defeat labelled as an outcome", () => {
    expect(
      territoryGameEventContract({
        eventType: "guardian_defeated",
        classification: "outcome",
        provenanceClass: "generated_game_fiction",
      })
    ).toBe(false);
  });

  it("accepts a properly classified game-projection clear", () => {
    expect(
      territoryGameEventContract({
        eventType: "territory_cleared",
        classification: "game_projection",
        provenanceClass: "generated_game_fiction",
      })
    ).toBe(true);
  });

  it("keeps a stable key identical for the same members in any order", () => {
    const a = stableTerritoryKey({
      tenantId: "default",
      grammar: "visit_hunt",
      physicalEntityIds: ["b3", "b1", "b2"],
    });
    const b = stableTerritoryKey({
      tenantId: "default",
      grammar: "visit_hunt",
      physicalEntityIds: ["b1", "b2", "b3"],
    });
    expect(a).toBe(b);
  });
});
