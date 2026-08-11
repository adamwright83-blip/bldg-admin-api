import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cueCategory } from "./AudioManager";
import { arcadeFeedback, businessVictoryFeedback, hapticsEnabled, setHapticsEnabled } from "./haptics";

describe("cueCategory", () => {
  it("distinguishes arcade feedback cues from the victory category", () => {
    expect(cueCategory("weak_point_hit")).toBe("encounter");
    expect(cueCategory("signal_lock")).toBe("encounter");
    expect(cueCategory("mechanism_align")).toBe("encounter");
    // Only an authoritative capture uses the victory category.
    expect(cueCategory("victory_flag")).toBe("victory");
  });

  it("keeps failure distinct from encounter success", () => {
    expect(cueCategory("arcade_miss")).toBe("failure");
  });
});

/**
 * This repo's client tests run under the "node" vitest environment (no
 * jsdom), so `window`/`navigator` are provided here as minimal fakes rather
 * than assuming a real DOM. haptics.ts reads storage fresh on every call (no
 * cached module state) and guards every browser access behind a
 * `typeof window === "undefined"` check, so it degrades safely here too.
 */
describe("haptics settings persistence", () => {
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

  it("defaults to enabled when nothing is stored", () => {
    expect(hapticsEnabled()).toBe(true);
  });

  it("persists a disabled preference locally", () => {
    setHapticsEnabled(false);
    expect(hapticsEnabled()).toBe(false);
    setHapticsEnabled(true);
    expect(hapticsEnabled()).toBe(true);
  });

  it("does not throw when navigator.vibrate is unsupported", () => {
    expect(() => arcadeFeedback()).not.toThrow();
    expect(() => businessVictoryFeedback()).not.toThrow();
  });
});
