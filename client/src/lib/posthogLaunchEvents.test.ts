import { beforeEach, describe, expect, it } from "vitest";
import { recordClaireInteraction } from "./posthog";

describe("PostHog launch event telemetry", () => {
  const store = new Map<string, string>();
  const fakeStorage: Storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };

  beforeEach(() => {
    store.clear();
    (globalThis as { window?: unknown }).window = { localStorage: fakeStorage };
  });

  it("sets the first-interaction marker in local storage on the first call", () => {
    expect(fakeStorage.getItem("joystick_claire_interacted")).toBeNull();
    recordClaireInteraction({ source: "first_test" });
    expect(fakeStorage.getItem("joystick_claire_interacted")).toBe("true");

    // Calling again does not overwrite or fail
    recordClaireInteraction({ source: "second_test" });
    expect(fakeStorage.getItem("joystick_claire_interacted")).toBe("true");
  });
});
