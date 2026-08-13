import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { liveMissionFictionKeys, reconcileFictionOnResume } from "./longHorizonResume";
import { loadFictionAssignment, saveFictionAssignmentIfAbsent } from "./fictionAssignmentStorage";
import type { PlayableMission } from "../state/GameState";

function mission(overrides: Partial<PlayableMission> = {}): PlayableMission {
  return {
    key: "mission:1",
    missionId: 1,
    moveId: null,
    name: "Real Account",
    address: null,
    navigationUrl: null,
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

describe("liveMissionFictionKeys", () => {
  it("produces one key per mission with a resolvable real action", () => {
    expect(liveMissionFictionKeys([mission()], NOW)).toHaveLength(1);
  });

  it("produces no key for a captured/closed mission", () => {
    expect(liveMissionFictionKeys([mission({ state: "captured" })], NOW)).toHaveLength(0);
  });
});

describe("reconcileFictionOnResume", () => {
  const store = new Map<string, string>();
  const fakeStorage: Storage = {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: key => store.get(key) ?? null,
    key: index => Array.from(store.keys())[index] ?? null,
    removeItem: key => void store.delete(key),
    setItem: (key, value) => void store.set(key, value),
  };

  beforeEach(() => {
    store.clear();
    (globalThis as { window?: unknown }).window = { localStorage: fakeStorage };
  });
  afterEach(() => delete (globalThis as { window?: unknown }).window);

  it("drops a mission-backed assignment whose action resolved", () => {
    const key = "resolved-key";
    saveFictionAssignmentIfAbsent({ stableMissionKey: key, templateId: "neutralize-v1", rulesVersion: 1, instantiatedAt: NOW.toISOString() });
    expect(reconcileFictionOnResume({ liveMissions: [], now: NOW }).prunedCount).toBe(1);
    expect(loadFictionAssignment(key)).toBeNull();
  });

  it("keeps a still-live mission assignment", () => {
    const liveMission = mission({ missionId: 42, phoneUrl: "tel:+13235550100" });
    const key = liveMissionFictionKeys([liveMission], NOW)[0]!;
    saveFictionAssignmentIfAbsent({ stableMissionKey: key, templateId: "neutralize-v1", rulesVersion: 1, instantiatedAt: NOW.toISOString() });
    expect(reconcileFictionOnResume({ liveMissions: [liveMission], now: NOW }).prunedCount).toBe(0);
    expect(loadFictionAssignment(key)).not.toBeNull();
  });

  it("does not prune a field-move route from mission-only reality", () => {
    const key = "route:move-a,move-b::none::PLACE_ITEM_AT_LOCATIONS::1";
    saveFictionAssignmentIfAbsent({ stableMissionKey: key, templateId: "neutralize-v1", rulesVersion: 1, instantiatedAt: NOW.toISOString() });
    expect(reconcileFictionOnResume({ liveMissions: [], now: NOW }).prunedCount).toBe(0);
    expect(loadFictionAssignment(key)).not.toBeNull();
  });

  it("does not resurrect a resolved mission story", () => {
    const key = "unfinished-story";
    saveFictionAssignmentIfAbsent({ stableMissionKey: key, templateId: "neutralize-v1", rulesVersion: 1, instantiatedAt: NOW.toISOString() });
    reconcileFictionOnResume({ liveMissions: [], now: NOW });
    expect(loadFictionAssignment(key)).toBeNull();
  });
});
