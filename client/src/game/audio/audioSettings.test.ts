import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioManager, cueCategory } from "./AudioManager";
import {
  arcadeFeedback,
  businessVictoryFeedback,
  hapticsEnabled,
  setHapticsEnabled,
} from "./haptics";

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

  it("keeps authoritative and transition language restrained", () => {
    expect(cueCategory("captured_truth")).toBe("world");
    expect(cueCategory("recovery_truth")).toBe("world");
    expect(cueCategory("corridor_transition")).toBe("traversal");
  });
});

describe("audio lifecycle", () => {
  it("deduplicates semantic cues across refetch/resume", () => {
    const manager = new AudioManager();
    const play = vi.spyOn(manager, "play").mockImplementation(() => {});
    manager.playOnce("captured_truth", "revision-1");
    manager.playOnce("captured_truth", "revision-1");
    manager.playOnce("captured_truth", "revision-2");
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("binds and cleans visibility, pagehide, pageshow, and focus symmetrically", () => {
    const manager = new AudioManager();
    const setBackgrounded = vi
      .spyOn(manager, "setBackgrounded")
      .mockImplementation(() => {});
    const documentTarget = Object.assign(new EventTarget(), {
      hidden: false,
    }) as unknown as Document;
    const windowTarget = new EventTarget() as unknown as Window;
    const cleanup = manager.bindLifecycle(documentTarget, windowTarget);

    windowTarget.dispatchEvent(new Event("pagehide"));
    windowTarget.dispatchEvent(new Event("pageshow"));
    expect(setBackgrounded).toHaveBeenCalledTimes(2);

    cleanup();
    cleanup();
    windowTarget.dispatchEvent(new Event("focus"));
    expect(setBackgrounded).toHaveBeenCalledTimes(2);
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
