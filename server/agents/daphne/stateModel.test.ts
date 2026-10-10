import { describe, expect, it } from "vitest";
import {
  assertOperationalStatePayload,
  deriveDaphneFastState,
  isDaphneFastStateExpired,
} from "./stateModel";
import type { DaphneObservationRecord } from "./observationStore";

function observation(overrides: Partial<DaphneObservationRecord> = {}): DaphneObservationRecord {
  return {
    id: "dobs_1",
    tenantId: "tenant-a",
    canonicalOperatorId: "operator-a",
    operatorUserId: "1",
    sessionId: "session-a",
    actorType: "user",
    actorId: "1",
    agentId: "claire",
    observationKind: "system_context_event",
    evidenceChannel: "system_record",
    verificationStatus: "verified",
    sourceType: "claire_turn",
    sourceReference: "turn:1",
    occurredAt: "2026-10-07T08:00:00.000Z",
    context: {
      currentGoal: "Finish the proposal",
      taskMode: "execution",
      urgency: "high",
      receptivity: "low_receptivity_to_interruption",
    },
    payload: null,
    metadata: null,
    idempotencyKey: "obs-1",
    createdAt: "2026-10-07T08:00:00.000Z",
    ...overrides,
  };
}

describe("Daphne V2 fast State", () => {
  it("does not renew yesterday's state when compiling a fresh card", () => {
    const state = deriveDaphneFastState({observations:[observation()],
      asOf:new Date("2026-10-08T08:05:00Z")});
    expect(state.currentGoal).toBeNull();
    expect(state.receptivity).toBe("unknown");
    expect(state.sourceObservationIds).toEqual([]);
  });

  it("does not promote disputed or unverified context into current state", () => {
    const state = deriveDaphneFastState({observations:[observation({verificationStatus:"disputed"})],
      asOf:new Date("2026-10-07T08:05:00Z")});
    expect(state.currentGoal).toBeNull();
  });
  it("derives operational state from structured evidence without inventing psychology", () => {
    const state = deriveDaphneFastState({
      observations: [observation()],
      asOf: new Date("2026-10-07T08:05:00.000Z"),
      ttlMinutes: 60,
    });

    expect(state.currentGoal).toBe("Finish the proposal");
    expect(state.taskMode).toBe("execution");
    expect(state.urgency).toBe("high");
    expect(state.receptivity).toBe("low_receptivity_to_interruption");
    expect(state.sourceObservationIds).toEqual(["dobs_1"]);
  });

  it("expires fast state rather than promoting a temporary observation into identity", () => {
    const state = deriveDaphneFastState({
      observations: [observation()],
      asOf: new Date("2026-10-07T08:05:00.000Z"),
      ttlMinutes: 30,
    });
    expect(isDaphneFastStateExpired(state, new Date("2026-10-07T08:34:59.000Z"))).toBe(false);
    expect(isDaphneFastStateExpired(state, new Date("2026-10-07T08:35:00.000Z"))).toBe(true);
  });

  it("fails closed on clinical labels in the State payload", () => {
    expect(() => assertOperationalStatePayload({ depression: 0.8 })).toThrow(
      /unsupported clinical construct/
    );
  });

  it("reports high epistemic uncertainty when structured state evidence is absent", () => {
    const state = deriveDaphneFastState({
      observations: [],
      asOf: new Date("2026-10-07T08:05:00.000Z"),
    });
    expect(state.taskMode).toBe("unknown");
    expect(state.uncertainty.epistemic).toBe(1);
  });
});
