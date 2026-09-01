import { describe, expect, it } from "vitest";
import { deterministicEstimate } from "../../shared/businessGame";
import { rankFieldMoves } from "./fieldOpportunityService";
import type { FieldMoveCandidate } from "./types";

const candidate: FieldMoveCandidate = {
  id: "mission:1:visit", moveType: "nearby_commercial_visit", title: "Visit Ridge",
  target: { entityType: "commercial_account", entityId: "1", name: "Ridge" }, expectedDurationMinutes: 35, travelMinutes: 5,
  expectedValue: deterministicEstimate({ lowCents: 10000, highCents: 50000 }, "fixture", "medium"), confidence: "medium",
  relevance: "Nearby", evidence: ["5 minutes away"], expiresAt: null, contactAllowed: true, withinServiceRadius: true,
  missionId: 1, missionVersion: 1, destinationPath: "/driver/sales-mission/1",
};

describe("contextual FIELD move hard filters", () => {
  it("allows a nearby prospect inside a 45-minute gap", () => {
    const now = new Date("2026-08-08T10:00:00Z");
    expect(rankFieldMoves({ now, nextCommitmentAt: new Date("2026-08-08T10:45:00Z"), capacityFull: false, currentLocationAvailable: true, candidates: [candidate] }).recommendedMoves).toHaveLength(1);
  });
  it("rejects a 40-minute burden inside a 20-minute gap", () => {
    const now = new Date("2026-08-08T10:00:00Z");
    const result = rankFieldMoves({ now, nextCommitmentAt: new Date("2026-08-08T10:20:00Z"), capacityFull: false, currentLocationAvailable: true, candidates: [candidate] });
    expect(result.recommendedMoves).toEqual([]);
    expect(result.reason).toBe("ROUTE_TOO_TIGHT");
  });
  it("returns no eligible target instead of forced activity", () => {
    expect(rankFieldMoves({ now: new Date(), nextCommitmentAt: null, capacityFull: false, currentLocationAvailable: false, candidates: [] }).reason).toBe("NO_ELIGIBLE_TARGET");
  });
  it("enforces contact permission", () => {
    const result = rankFieldMoves({ now: new Date(), nextCommitmentAt: null, capacityFull: false, currentLocationAvailable: true, candidates: [{ ...candidate, contactAllowed: false }] });
    expect(result.recommendedMoves).toEqual([]);
  });
  it("suppresses a discretionary visit at full capacity", () => {
    const result = rankFieldMoves({ now: new Date(), nextCommitmentAt: null, capacityFull: true, currentLocationAvailable: true, candidates: [candidate] });
    expect(result.reason).toBe("CAPACITY_FULL");
  });
  it("does not call a prospect nearby when current geography is unavailable", () => {
    const result = rankFieldMoves({ now: new Date("2026-08-08T10:00:00Z"), nextCommitmentAt: null, capacityFull: false, currentLocationAvailable: false, candidates: [candidate] });
    expect(result.recommendedMoves).toEqual([]);
    expect(result.reason).toBe("DATA_INSUFFICIENT");
  });
  it("still allows a sourced phone call when geography is unavailable", () => {
    const callCandidate: FieldMoveCandidate = {
      ...candidate,
      id: "mission:1:call",
      moveType: "commercial_call",
      title: "Call Ridge",
      expectedDurationMinutes: 15,
      travelMinutes: 0,
      relevance: "A sourced business contact is available",
    };
    const result = rankFieldMoves({ now: new Date("2026-08-08T10:00:00Z"), nextCommitmentAt: null, capacityFull: false, currentLocationAvailable: false, candidates: [candidate, callCandidate] });
    expect(result.recommendedMoves.map(item => item.id)).toEqual(["mission:1:call"]);
    expect(result.reason).toBe("MOVES_AVAILABLE");
  });
});
