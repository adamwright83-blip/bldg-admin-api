import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_WAYWARD_PROGRESS, hasColosseumResolved, loadWaywardProgress, markColosseumResolved, saveWaywardProgress, unlockWayward, waywardProgressKey } from "./waywardProgress";

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
    saveWaywardProgress("a", { unlocked: true, visited: true, guardianCleared: true, cacheCollected: true, tetherAwake: true, relic: "tether-memory" });
    expect(loadWaywardProgress("a").relic).toBe("tether-memory");
    expect(waywardProgressKey("a")).not.toBe(waywardProgressKey("b"));
  });

  it("scopes the Colosseum resolution gate by player", () => {
    (globalThis as { window?: unknown }).window = { localStorage: fakeStorage };
    markColosseumResolved("a");
    expect(hasColosseumResolved("a")).toBe(true);
    expect(hasColosseumResolved("b")).toBe(false);
  });
});
