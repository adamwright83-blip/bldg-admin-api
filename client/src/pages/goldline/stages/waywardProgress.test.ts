import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_WAYWARD_PROGRESS, hasColosseumResolved, hasLegacyDay1Dismissal, loadWaywardProgress, markColosseumResolved, markLegacyDay1Dismissal, saveWaywardProgress, shouldAutoEnterWayward, unlockWayward, waywardProgressKey } from "./waywardProgress";

const values = new Map<string, string>();
const fakeStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };

describe("Wayward fantasy persistence", () => {
  afterEach(() => { values.clear(); delete (globalThis as { window?: unknown }).window; });

  it("stays locked until the truthful campaign resolution unlocks fantasy", () => {
    (globalThis as { window?: unknown }).window = { localStorage: fakeStorage };
    expect(loadWaywardProgress("a")).toEqual(EMPTY_WAYWARD_PROGRESS);
    expect(unlockWayward("a").unlocked).toBe(true);
    expect(loadWaywardProgress("b").unlocked).toBe(false);
  });

  it("persists only fictional consequences per player", () => {
    (globalThis as { window?: unknown }).window = { localStorage: fakeStorage };
    saveWaywardProgress("a", { unlocked: true, visited: true, guardianCleared: true, spanCrossed: true, cacheCollected: true, tetherAwake: true, relic: "tether-memory" });
    expect(loadWaywardProgress("a").relic).toBe("tether-memory");
    expect(waywardProgressKey("a")).not.toBe(waywardProgressKey("b"));
  });

  it("scopes the Colosseum resolution gate by player", () => {
    (globalThis as { window?: unknown }).window = { localStorage: fakeStorage };
    markColosseumResolved("a");
    expect(hasColosseumResolved("a")).toBe(true);
    expect(hasColosseumResolved("b")).toBe(false);
  });

  it("treats blocked legacy storage access as an absent migration flag", () => {
    (globalThis as { window?: unknown }).window = {
      get localStorage() { throw new DOMException("blocked", "SecurityError"); },
    };
    expect(hasLegacyDay1Dismissal()).toBe(false);
    expect(() => markLegacyDay1Dismissal()).not.toThrow();
  });

  it("auto-enters production Wayward only from truthful completion continuity", () => {
    expect(shouldAutoEnterWayward({ colosseumResolved: true, campaignComplete: true, testHarness: false })).toBe(true);
    expect(shouldAutoEnterWayward({ colosseumResolved: false, campaignComplete: true, testHarness: false })).toBe(false);
    expect(shouldAutoEnterWayward({ colosseumResolved: true, campaignComplete: false, testHarness: false })).toBe(false);
    expect(shouldAutoEnterWayward({ colosseumResolved: true, campaignComplete: true, testHarness: true })).toBe(false);
  });
});
