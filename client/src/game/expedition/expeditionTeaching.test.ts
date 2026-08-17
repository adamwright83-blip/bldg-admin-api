import { describe, expect, it } from "vitest";
import {
  EXPEDITION_MECHANICS,
  expeditionTeachingStorageKey,
  isMechanicLearned,
  markMechanicLearned,
  mechanicLearningState,
  nextUnlearnedMechanic,
  resetAllExpeditionTeaching,
  resetExpeditionTeaching,
} from "./expeditionTeaching";

/** Same fake-window pattern as checkpointStorage.test.ts / onboardingProgress.test.ts. */
describe("expeditionTeaching", () => {
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

  function withFakeWindow<T>(fn: () => T): T {
    (globalThis as { window?: unknown }).window = { localStorage: fakeStorage };
    try {
      return fn();
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  }

  it("starts unlearned", () => {
    withFakeWindow(() => {
      store.clear();
      expect(isMechanicLearned("strike")).toBe(false);
    });
  });

  it("retires only when explicitly marked, never merely from being displayed", () => {
    withFakeWindow(() => {
      store.clear();
      expect(mechanicLearningState("strike", true)).toBe("teaching");
      // Displaying the hint (relevantNow: true) many times must not learn it.
      expect(mechanicLearningState("strike", true)).toBe("teaching");
      expect(mechanicLearningState("strike", true)).toBe("teaching");
      expect(isMechanicLearned("strike")).toBe(false);

      markMechanicLearned("strike");
      expect(isMechanicLearned("strike")).toBe(true);
      expect(mechanicLearningState("strike", true)).toBe("learned");
      // Once learned, it never demotes back to teaching or unlearned even
      // if the caller still considers it contextually relevant.
      expect(mechanicLearningState("strike", false)).toBe("learned");
    });
  });

  it("is idempotent — marking an already-learned mechanic is a no-op", () => {
    withFakeWindow(() => {
      store.clear();
      markMechanicLearned("evade");
      markMechanicLearned("evade");
      expect(isMechanicLearned("evade")).toBe(true);
    });
  });

  it("mechanicLearningState reports unlearned when not yet relevant", () => {
    withFakeWindow(() => {
      store.clear();
      expect(mechanicLearningState("line", false)).toBe("unlearned");
    });
  });

  it("nextUnlearnedMechanic walks the canonical teaching order", () => {
    withFakeWindow(() => {
      store.clear();
      expect(nextUnlearnedMechanic()).toBe("strike");
      markMechanicLearned("strike");
      expect(nextUnlearnedMechanic()).toBe("evade");
      markMechanicLearned("evade");
      expect(nextUnlearnedMechanic()).toBe("line");
      markMechanicLearned("line");
      markMechanicLearned("relic");
      markMechanicLearned("fork");
      expect(nextUnlearnedMechanic()).toBeNull();
    });
  });

  it("survives a corrupted value without throwing", () => {
    withFakeWindow(() => {
      store.clear();
      fakeStorage.setItem(expeditionTeachingStorageKey(null), "{not json");
      expect(() => isMechanicLearned("strike")).not.toThrow();
      expect(isMechanicLearned("strike")).toBe(false);
    });
  });

  it("resetExpeditionTeaching clears learning state so tests can reset it", () => {
    withFakeWindow(() => {
      store.clear();
      markMechanicLearned("strike");
      markMechanicLearned("evade");
      resetExpeditionTeaching();
      expect(isMechanicLearned("strike")).toBe(false);
      expect(isMechanicLearned("evade")).toBe(false);
    });
  });

  describe("identity scoping — a shared phone must not inherit another player's flags", () => {
    it("does not leak one player's learned mechanics to another", () => {
      withFakeWindow(() => {
        store.clear();
        markMechanicLearned("strike", "driver-a");
        expect(isMechanicLearned("strike", "driver-b")).toBe(false);
        expect(isMechanicLearned("strike", "driver-a")).toBe(true);
      });
    });

    it("scopes the anon bucket separately from any real account", () => {
      withFakeWindow(() => {
        store.clear();
        markMechanicLearned("strike", null);
        expect(isMechanicLearned("strike", "driver-a")).toBe(false);
      });
    });

    it("resetExpeditionTeaching only clears the identity it is given", () => {
      withFakeWindow(() => {
        store.clear();
        markMechanicLearned("strike", "driver-a");
        markMechanicLearned("strike", "driver-b");
        resetExpeditionTeaching("driver-a");
        expect(isMechanicLearned("strike", "driver-a")).toBe(false);
        expect(isMechanicLearned("strike", "driver-b")).toBe(true);
      });
    });

    it("resetAllExpeditionTeaching clears every identity on the device", () => {
      withFakeWindow(() => {
        store.clear();
        markMechanicLearned("strike", "driver-a");
        markMechanicLearned("evade", "driver-b");
        markMechanicLearned("line", null);
        resetAllExpeditionTeaching();
        expect(isMechanicLearned("strike", "driver-a")).toBe(false);
        expect(isMechanicLearned("evade", "driver-b")).toBe(false);
        expect(isMechanicLearned("line", null)).toBe(false);
      });
    });
  });

  it("exports the canonical mechanic list in teaching order", () => {
    expect(EXPEDITION_MECHANICS).toEqual(["strike", "evade", "line", "relic", "fork"]);
  });
});
