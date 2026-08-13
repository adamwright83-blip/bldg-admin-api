import { describe, expect, it } from "vitest";
import type { PlayableMission } from "../state/GameState";
import { selectMissionDirector } from "../state/MissionDirector";
import { projectAuthoritativeOutcome } from "./authoritativeOutcome";
import {
  createEncounterRuntime,
  transitionEncounter,
} from "./encounterLifecycle";
import { projectMissionAffordance } from "./missionAffordance";

function mission(overrides: Partial<PlayableMission> = {}): PlayableMission {
  return {
    key: "mission:42",
    missionId: 42,
    moveId: null,
    name: "Real-style fixture",
    address: null,
    navigationUrl: null,
    phoneUrl: "tel:15555550100",
    destinationPath: "/driver/sales-mission/42",
    state: "active",
    timeBurdenMinutes: null,
    travelBurdenMinutes: null,
    estimatedValueLowCents: null,
    estimatedValueHighCents: null,
    confidence: "high",
    expiresAt: null,
    contestedUntil: null,
    verifiedAnnualValueCents: null,
    realizedRevenueCents: 0,
    unlockedPath: null,
    lossReason: null,
    ...overrides,
  };
}

function awaitingOutcome() {
  let runtime = createEncounterRuntime({
    encounterId: "fixture:42",
    missionId: 42,
    archetype: "GATEKEEPER",
    channel: "phone",
  });
  runtime = transitionEncounter(runtime, {
    type: "PHYSICAL_APPROACH_COMPLETED",
  });
  runtime = transitionEncounter(runtime, {
    type: "STRATEGY_SELECTED",
    strategyId: "real-strategy",
  });
  runtime = transitionEncounter(runtime, { type: "GAME_CHALLENGE_COMPLETED" });
  runtime = transitionEncounter(runtime, {
    type: "REAL_ACTION_STARTED",
    requestId: "persist-1",
  });
  return transitionEncounter(runtime, { type: "REAL_ACTION_PERSISTED" });
}

describe("deterministic encounter-to-outcome fixture", () => {
  it("chains only after persisted action and authoritative refetch", () => {
    const now = new Date("2026-08-12T12:00:00Z");
    const first = mission();
    expect(selectMissionDirector([first], now).primary?.missionId).toBe(42);
    expect(projectMissionAffordance(first, now).primary).toBe("CALL");
    const runtime = awaitingOutcome();
    expect(runtime.phase).toBe("AWAITING_OUTCOME");

    const refetched = mission({
      state: "captured",
      verifiedAnnualValueCents: 120_000,
    });
    expect(projectAuthoritativeOutcome(refetched).kind).toBe("captured");
    const resolved = transitionEncounter(runtime, {
      type: "AUTHORITATIVE_RESOLVED",
      revision: "server:captured:2",
    });
    expect(resolved.phase).toBe("RESOLVED");

    const legitimateNext = mission({
      key: "mission:43",
      missionId: 43,
      phoneUrl: null,
      address: "100 Real St",
      navigationUrl: "https://maps.example/real",
    });
    expect(
      selectMissionDirector([legitimateNext], now).primary?.missionId
    ).toBe(43);
    expect(projectMissionAffordance(legitimateNext, now).primary).toBe("VISIT");
  });

  it("keeps perfect play unresolved when the backend is unresolved", () => {
    const runtime = awaitingOutcome(); // the lifecycle has no performance input
    expect(projectAuthoritativeOutcome(mission())).toEqual({
      kind: "unresolved",
      mutationType: null,
    });
    expect(
      transitionEncounter(runtime, {
        type: "AUTHORITATIVE_UNRESOLVED",
        revision: "server:no-answer:2",
      }).phase
    ).toBe("UNRESOLVED");
  });

  it("preserves an authoritative win even if game execution was poor", () => {
    expect(projectAuthoritativeOutcome(mission({ state: "captured" }))).toEqual(
      {
        kind: "captured",
        mutationType: "CAPTURED_PATH",
      }
    );
  });
});
