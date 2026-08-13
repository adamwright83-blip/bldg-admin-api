import { describe, expect, it } from "vitest";
import { projectTodayRoute } from "./todayRoute";
import type { PlayableMission } from "../state/GameState";

function mission(overrides: Partial<PlayableMission> = {}): PlayableMission {
  return {
    key: "mission:1",
    missionId: 1,
    moveId: null,
    name: "Real Account",
    address: "1 Real St",
    navigationUrl: "https://maps.example/1",
    phoneUrl: "tel:+13235550100",
    destinationPath: "/driver/sales-mission/1",
    state: "active",
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

const NOW = new Date("2026-08-13T12:00:00Z");

describe("projectTodayRoute", () => {
  it("zero authoritative missions produces zero route entries — no floor, no invented filler", () => {
    expect(projectTodayRoute({ missions: [], now: NOW })).toEqual([]);
  });

  it("contains exactly one entry per real live mission passed in", () => {
    const missions = [
      mission({ key: "a", missionId: 1 }),
      mission({ key: "b", missionId: 2 }),
    ];
    const route = projectTodayRoute({ missions, now: NOW });
    expect(route).toHaveLength(2);
  });

  it("does not filter its input — callers must supply already-live missions", () => {
    const missions = [
      mission({ key: "a", missionId: 1, state: "captured" }),
      mission({ key: "b", missionId: 2, state: "closed" }),
      mission({ key: "c", missionId: 3, state: "active" }),
    ];
    // rankMissionsForRoute itself does not filter — todayRoute inherits
    // whatever the caller passed. This test documents that callers must
    // supply already-live missions (matching projectPlayableMissions'
    // filter), not that this function silently filters twice.
    const route = projectTodayRoute({ missions, now: NOW });
    expect(route.map(entry => entry.mission.key).sort()).toEqual(["a", "b", "c"]);
  });

  it("is deterministic — the same input always produces the same order", () => {
    const missions = [
      mission({ key: "a", missionId: 1, phoneUrl: "tel:1" }),
      mission({ key: "b", missionId: 2, state: "contested", contestedUntil: "2026-08-01T00:00:00Z" }),
      mission({ key: "c", missionId: 3, state: "recovery_active" }),
    ];
    const runs = Array.from({ length: 10 }, () => projectTodayRoute({ missions, now: NOW }));
    const order = runs.map(route => route.map(entry => entry.mission.key).join(","));
    expect(new Set(order).size).toBe(1);
  });

  it("annotates each entry with the real ActionGrammar backing that mission's real affordance", () => {
    const missions = [mission({ key: "a", missionId: 1, phoneUrl: "tel:+13235550100" })];
    const route = projectTodayRoute({ missions, now: NOW });
    expect(route[0]!.grammar?.kind).toBe("CALL_PERSON");
  });

  it("does not invent geography or a distance — locations always come from the real mission address", () => {
    const missions = [
      mission({ key: "a", missionId: 1, phoneUrl: null, address: "42 Genuine Ave", navigationUrl: "https://maps.example/genuine", destinationPath: "/driver/sales-mission/1" }),
    ];
    const route = projectTodayRoute({ missions, now: NOW });
    expect(route[0]!.grammar?.locations).toEqual(["42 Genuine Ave"]);
  });

  it("a mission with no resolvable action gets a null grammar rather than a fabricated one", () => {
    const missions = [
      mission({ key: "a", missionId: null, moveId: null, phoneUrl: null, address: null, navigationUrl: null }),
    ];
    const route = projectTodayRoute({ missions, now: NOW });
    expect(route[0]!.grammar).toBeNull();
  });
});

describe("dynamic reprojection (Slice 96) — same pure function, re-run on new input", () => {
  it("reprojects immediately when a mission's real state changes — no restart required", () => {
    const missions = [mission({ key: "a", missionId: 1, state: "active", phoneUrl: "tel:1" })];
    const before = projectTodayRoute({ missions, now: NOW });
    expect(before[0]!.grammar?.kind).toBe("CALL_PERSON");

    const resolved = [mission({ key: "a", missionId: 1, state: "captured" })];
    const after = projectTodayRoute({ missions: resolved, now: NOW });
    expect(after[0]!.grammar).toBeNull(); // captured missions resolve to no action affordance
  });

  it("a newly-arrived real mission appears in the very next projection", () => {
    const before = projectTodayRoute({ missions: [], now: NOW });
    expect(before).toHaveLength(0);

    const after = projectTodayRoute({
      missions: [mission({ key: "new", missionId: 99 })],
      now: NOW,
    });
    expect(after).toHaveLength(1);
  });

  it("does not reshuffle for novelty — identical input at a later time produces identical order", () => {
    const missions = [
      mission({ key: "a", missionId: 1, phoneUrl: "tel:1" }),
      mission({ key: "b", missionId: 2, phoneUrl: "tel:2" }),
    ];
    const first = projectTodayRoute({ missions, now: NOW });
    const later = projectTodayRoute({ missions, now: new Date(NOW.getTime() + 86_400_000) });
    expect(first.map(e => e.mission.key)).toEqual(later.map(e => e.mission.key));
  });
});
