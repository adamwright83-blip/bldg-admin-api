import { describe, expect, it } from "vitest";
import { selectMissionDirector } from "./MissionDirector";
import type { PlayableMission } from "./GameState";

function mission(overrides: Partial<PlayableMission>): PlayableMission {
  return {
    key: "mission:1",
    missionId: 1,
    moveId: null,
    name: "Test Account",
    address: null,
    navigationUrl: null,
    phoneUrl: null,
    destinationPath: null,
    state: "available",
    timeBurdenMinutes: null,
    travelBurdenMinutes: null,
    estimatedValueLowCents: null,
    estimatedValueHighCents: null,
    confidence: "unknown",
    expiresAt: null,
    contestedUntil: null,
    verifiedAnnualValueCents: null,
    realizedRevenueCents: 0,
    unlockedPath: null,
    lossReason: null,
    ...overrides,
  };
}

const NOW = new Date("2026-08-11T12:00:00.000Z");

describe("selectMissionDirector", () => {
  it("curates a small presentation from many legitimate missions", () => {
    const missions = Array.from({ length: 8 }, (_, i) =>
      mission({ key: `mission:${i}`, missionId: i, state: "available", moveId: `move-${i}` })
    );
    const result = selectMissionDirector(missions, NOW);
    expect(result.primary).not.toBeNull();
    expect(result.secondary.length).toBeLessThanOrEqual(2);
  });

  it("prioritizes an actually-due real follow-up over a not-yet-due one", () => {
    const due = mission({
      key: "mission:due",
      state: "contested",
      contestedUntil: "2026-08-11T10:00:00.000Z",
    });
    const notDue = mission({
      key: "mission:not-due",
      state: "contested",
      contestedUntil: "2026-08-13T10:00:00.000Z",
    });
    const result = selectMissionDirector([notDue, due], NOW);
    expect(result.primary?.key).toBe("mission:due");
  });

  it("excludes closed missions is the caller's job — director only ranks what it's given", () => {
    // projectPlayableMissions already filters captured/closed before this
    // runs; MissionDirector never re-admits a state it wasn't given.
    const watching = mission({ key: "mission:watch", state: "watching" });
    const result = selectMissionDirector([watching], NOW);
    expect(result.primary?.key).toBe("mission:watch");
  });

  it("does not treat a not-due watch state as urgent", () => {
    const watching = mission({ key: "mission:watch", state: "watching", contestedUntil: null });
    const recoveryActive = mission({ key: "mission:recovery", state: "recovery_active" });
    const result = selectMissionDirector([watching, recoveryActive], NOW);
    expect(result.primary?.key).toBe("mission:recovery");
  });

  it("ranks a Scout candidate the same as any other 'available' mission — not yet a FIELD mission", () => {
    // A raw Scout discovery isn't passed to the director at all until it
    // becomes a real mission (see MISSION_SOURCE_ARCHITECTURE.md); once it
    // is, it's ranked purely on its real state like anything else.
    const scoutBacked = mission({ key: "mission:scout", state: "available", moveId: null });
    const fieldReady = mission({ key: "mission:field", state: "available", moveId: "move-1" });
    const result = selectMissionDirector([scoutBacked, fieldReady], NOW);
    expect(result.primary?.key).toBe("mission:field");
  });

  it("is deterministic across repeated calls with the same input", () => {
    const missions = [
      mission({ key: "mission:a", state: "contested", contestedUntil: "2026-08-11T09:00:00.000Z" }),
      mission({ key: "mission:b", state: "recovery_active" }),
      mission({ key: "mission:c", state: "available", moveId: "m1" }),
    ];
    const first = selectMissionDirector(missions, NOW);
    const second = selectMissionDirector(missions, NOW);
    expect(first.primary?.key).toBe(second.primary?.key);
    expect(first.secondary.map(m => m.key)).toEqual(second.secondary.map(m => m.key));
  });
});
