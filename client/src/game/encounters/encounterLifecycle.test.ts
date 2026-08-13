import { describe, expect, it } from "vitest";
import {
  createEncounterRuntime,
  transitionEncounter,
} from "./encounterLifecycle";

function approaching() {
  return createEncounterRuntime({
    encounterId: "fixture:42",
    missionId: 42,
    archetype: "GATEKEEPER",
    channel: "phone",
  });
}

describe("encounter lifecycle", () => {
  it("starts approaching and follows the physical/action/authority sequence", () => {
    let state = approaching();
    expect(state.phase).toBe("APPROACHING");
    state = transitionEncounter(state, { type: "PHYSICAL_APPROACH_COMPLETED" });
    state = transitionEncounter(state, {
      type: "STRATEGY_SELECTED",
      strategyId: "route",
    });
    state = transitionEncounter(state, { type: "GAME_CHALLENGE_COMPLETED" });
    state = transitionEncounter(state, {
      type: "REAL_ACTION_STARTED",
      requestId: "request-1",
    });
    state = transitionEncounter(state, { type: "REAL_ACTION_PERSISTED" });
    state = transitionEncounter(state, {
      type: "AUTHORITATIVE_RESOLVED",
      revision: "server:2",
    });
    expect(state.phase).toBe("RESOLVED");
    expect(state.authoritativeRevision).toBe("server:2");
  });

  it("rejects direct resolution and action completion before persistence", () => {
    expect(() =>
      transitionEncounter(approaching(), {
        type: "AUTHORITATIVE_RESOLVED",
        revision: "fake",
      })
    ).toThrow(/Illegal encounter transition/);
    expect(() =>
      transitionEncounter(approaching(), { type: "REAL_ACTION_PERSISTED" })
    ).toThrow(/Illegal encounter transition/);
  });

  it("keeps unresolved authoritative outcomes playable as recovery", () => {
    let state = approaching();
    state = transitionEncounter(state, { type: "PHYSICAL_APPROACH_COMPLETED" });
    state = transitionEncounter(state, {
      type: "STRATEGY_SELECTED",
      strategyId: "route",
    });
    state = transitionEncounter(state, { type: "GAME_CHALLENGE_COMPLETED" });
    state = transitionEncounter(state, {
      type: "REAL_ACTION_STARTED",
      requestId: "request-1",
    });
    state = transitionEncounter(state, { type: "REAL_ACTION_PERSISTED" });
    state = transitionEncounter(state, {
      type: "AUTHORITATIVE_UNRESOLVED",
      revision: "server:3",
    });
    expect(state.phase).toBe("RECOVERY");
  });
});
