import { describe, expect, it } from "vitest";
import { deriveDaphneContext } from "./contextModel";
import type { DaphneObservationRecord } from "./observationStore";

function obs(id: string, occurredAt: string, context: Record<string, unknown>): DaphneObservationRecord {
  return {
    id,
    tenantId: "tenant-a",
    canonicalOperatorId: "operator-a",
    operatorUserId: "1",
    sessionId: "session-a",
    actorType: "system",
    actorId: null,
    agentId: "claire",
    observationKind: "system_context_event",
    evidenceChannel: "system_record",
    verificationStatus: "verified",
    sourceType: "turn_context",
    sourceReference: id,
    occurredAt,
    context,
    payload: null,
    metadata: null,
    idempotencyKey: id,
    createdAt: occurredAt,
  };
}

describe("Daphne V2 Context/regime model", () => {
  it("expires old context and excludes unverified observations", () => {
    const old=obs("old","2026-10-07T08:00:00Z",{taskMode:"execution"});
    expect(deriveDaphneContext({observations:[old],asOf:new Date("2026-10-08T08:00:00Z")}).taskMode).toBe("unknown");
    expect(deriveDaphneContext({observations:[{...old,verificationStatus:"unverified"}],
      asOf:new Date("2026-10-07T08:01:00Z")}).sourceObservationIds).toEqual([]);
  });
  it("uses structured situation fields rather than free-text personality inference", () => {
    const value = deriveDaphneContext({
      observations: [
        obs("a", "2026-10-07T08:00:00.000Z", {
          taskFamily: "repo_change",
          taskMode: "execution",
          stakes: "high",
          urgency: "high",
          channel: "voice",
          currentGoal: "ship fix",
        }),
      ],
      asOf: new Date("2026-10-07T08:01:00.000Z"),
    });
    expect(value.taskFamily).toBe("repo_change");
    expect(value.taskMode).toBe("execution");
    expect(value.stakes).toBe("high");
    expect(value.possibleRegimeChange).toBe(false);
  });

  it("does not call one changed observation a regime change by default", () => {
    const old = deriveDaphneContext({
      observations: [
        obs("old", "2026-10-07T07:00:00.000Z", {
          taskFamily: "planning",
          taskMode: "planning",
        }),
      ],
      asOf: new Date("2026-10-07T07:01:00.000Z"),
    });

    const one = deriveDaphneContext({
      observations: [
        obs("new", "2026-10-07T08:00:00.000Z", {
          taskFamily: "incident",
          taskMode: "execution",
        }),
      ],
      asOf: new Date("2026-10-07T08:01:00.000Z"),
      previousRegimeKey: old.regimeKey,
    });
    expect(one.possibleRegimeChange).toBe(false);
    expect(one.changeEvidenceCount).toBe(1);
  });

  it("flags a possible regime change after repeated structured evidence and preserves the old regime", () => {
    const old = deriveDaphneContext({
      observations: [
        obs("old", "2026-10-07T07:00:00.000Z", {
          taskFamily: "planning",
          taskMode: "planning",
        }),
      ],
      asOf: new Date("2026-10-07T07:01:00.000Z"),
    });
    const changed = deriveDaphneContext({
      observations: [
        obs("new-2", "2026-10-07T08:01:00.000Z", {
          taskFamily: "incident",
          taskMode: "execution",
        }),
        obs("new-1", "2026-10-07T08:00:00.000Z", {
          taskFamily: "incident",
          taskMode: "execution",
        }),
      ],
      asOf: new Date("2026-10-07T08:02:00.000Z"),
      previousRegimeKey: old.regimeKey,
    });

    expect(changed.possibleRegimeChange).toBe(true);
    expect(changed.previousRegimeKey).toBe(old.regimeKey);
    expect(changed.regimeKey).not.toBe(old.regimeKey);
  });
});
