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
    const keys = liveMissionFictionKeys([mission()], NOW);
    expect(keys).toHaveLength(1);
  });

  it("produces no key for a captured/closed mission — nothing to instantiate fiction for", () => {
    const keys = liveMissionFictionKeys([mission({ state: "captured" })], NOW);
    expect(keys).toHaveLength(0);
  });
});

describe("reconcileFictionOnResume — reality wins", () => {
  const store = new Map<string, string>();
  const fakeStorage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, value),
  };

  beforeEach(() => {
    store.clear();
    (globalThis as { window?: unknown }).window = { localStorage: fakeStorage };
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("drops a fiction assignment whose real action resolved while offline", () => {
    const resolvedKey = "resolved-key";
    saveFictionAssignmentIfAbsent({
      stableMissionKey: resolvedKey,
      templateId: "neutralize-v1",
      rulesVersion: 1,
      instantiatedAt: NOW.toISOString(),
    });

    // Reality re-read on resume: the mission that produced `resolvedKey` no
    // longer exists among live missions (it was captured/closed offline).
    const { prunedCount } = reconcileFictionOnResume({ liveMissions: [], now: NOW });

    expect(loadFictionAssignment(resolvedKey)).toBeNull();
    expect(prunedCount).toBe(1);
  });

  it("keeps an assignment whose real action is still genuinely unresolved after resume", () => {
    const liveMission = mission({ missionId: 42, phoneUrl: "tel:+13235550100" });
    const keys = liveMissionFictionKeys([liveMission], NOW);
    saveFictionAssignmentIfAbsent({
      stableMissionKey: keys[0]!,
      templateId: "neutralize-v1",
      rulesVersion: 1,
      instantiatedAt: NOW.toISOString(),
    });

    const { prunedCount } = reconcileFictionOnResume({
      liveMissions: [liveMission],
      now: NOW,
    });

    expect(loadFictionAssignment(keys[0]!)).not.toBeNull();
    expect(prunedCount).toBe(0);
  });

  it("never resurrects a resolved mission's story merely because it was unfinished", () => {
    const key = "unfinished-story";
    saveFictionAssignmentIfAbsent({
      stableMissionKey: key,
      templateId: "neutralize-v1",
      rulesVersion: 1,
      instantiatedAt: NOW.toISOString(),
    });
    reconcileFictionOnResume({ liveMissions: [], now: NOW });
    // A later call with the SAME (now-gone) key still finds nothing — the
    // Fiction Director has no path back to it once pruned.
    expect(loadFictionAssignment(key)).toBeNull();
  });
});
