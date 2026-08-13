import { describe, expect, it } from "vitest";
import { projectAuthoritativeOutcome } from "./authoritativeOutcome";
import {
  createEncounterRuntime,
  transitionEncounter,
} from "./encounterLifecycle";
import type { PlayableMission } from "../state/GameState";

function mission(state: PlayableMission["state"] = "active"): PlayableMission {
  return {
    key: "mission:71",
    missionId: 71,
    moveId: null,
    name: "Authoritative fixture",
    address: "71 Goldline Way",
    navigationUrl:
      "https://www.google.com/maps/dir/?api=1&destination=71%20Goldline%20Way",
    phoneUrl: "tel:+13105550171",
    destinationPath: "/driver/sales-mission/71",
    state,
    timeBurdenMinutes: 15,
    travelBurdenMinutes: 8,
    estimatedValueLowCents: null,
    estimatedValueHighCents: null,
    confidence: "high",
    expiresAt: null,
    contestedUntil: null,
    verifiedAnnualValueCents: null,
    realizedRevenueCents: 0,
    unlockedPath: null,
    lossReason: null,
  };
}

function awaitingOutcome() {
  let lifecycle = createEncounterRuntime({
    encounterId: "fixture-71",
    missionId: 71,
    archetype: "ANCHOR",
    channel: "phone",
  });
  lifecycle = transitionEncounter(lifecycle, {
    type: "PHYSICAL_APPROACH_COMPLETED",
  });
  lifecycle = transitionEncounter(lifecycle, {
    type: "STRATEGY_SELECTED",
    strategyId: "fixture-strategy",
  });
  lifecycle = transitionEncounter(lifecycle, {
    type: "GAME_CHALLENGE_COMPLETED",
  });
  lifecycle = transitionEncounter(lifecycle, {
    type: "REAL_ACTION_STARTED",
    requestId: "d8f87b19-9578-4bdf-9be5-75a65dd8bf63",
  });
  return transitionEncounter(lifecycle, { type: "REAL_ACTION_PERSISTED" });
}

describe("continuous authoritative business loop fixtures", () => {
  it("projects a backend win after persistence regardless of arcade quality", () => {
    const lifecycle = awaitingOutcome();
    const outcome = projectAuthoritativeOutcome(mission("captured"));
    const resolved = transitionEncounter(lifecycle, {
      type: "AUTHORITATIVE_RESOLVED",
      revision: "server:captured:v2",
    });

    expect(outcome.kind).toBe("captured");
    expect(resolved.phase).toBe("RESOLVED");
    expect(resolved.actionRequestId).toBe(
      "d8f87b19-9578-4bdf-9be5-75a65dd8bf63"
    );
  });

  it("keeps perfect arcade play unresolved when backend state is unchanged", () => {
    const lifecycle = awaitingOutcome();
    expect(projectAuthoritativeOutcome(mission("active")).kind).toBe(
      "unresolved"
    );
    expect(
      transitionEncounter(lifecycle, {
        type: "AUTHORITATIVE_UNRESOLVED",
        revision: "server:active:v1",
      }).phase
    ).toBe("UNRESOLVED");
  });

  it("never treats unresolved as recovery without server support", () => {
    expect(projectAuthoritativeOutcome(mission("active")).kind).toBe(
      "unresolved"
    );
    expect(
      projectAuthoritativeOutcome(mission("recovery_available")).kind
    ).toBe("recovery");
  });
});
