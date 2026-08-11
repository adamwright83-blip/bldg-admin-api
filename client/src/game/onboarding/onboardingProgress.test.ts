import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hasOnboardingMilestone,
  markOnboardingMilestone,
} from "./onboardingProgress";

/**
 * This repo's client tests run under the "node" vitest environment (no
 * jsdom), so `window` is provided here as a minimal fake rather than
 * assuming a real DOM — same pattern as audioSettings.test.ts.
 */
describe("onboardingProgress", () => {
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

  it("reports a milestone as incomplete before it is marked", () => {
    expect(hasOnboardingMilestone("movement")).toBe(false);
  });

  it("persists a marked milestone across reads", () => {
    markOnboardingMilestone("jump");
    expect(hasOnboardingMilestone("jump")).toBe(true);
    expect(hasOnboardingMilestone("climb")).toBe(false);
  });

  it("is idempotent — marking twice does not duplicate or error", () => {
    markOnboardingMilestone("vault");
    markOnboardingMilestone("vault");
    const raw = fakeStorage.getItem("goldline:onboarding:v1");
    const parsed = JSON.parse(raw ?? "[]");
    expect(parsed.filter((v: string) => v === "vault")).toHaveLength(1);
  });

  it("survives a corrupted storage value without throwing", () => {
    fakeStorage.setItem("goldline:onboarding:v1", "{not json");
    expect(() => hasOnboardingMilestone("movement")).not.toThrow();
    expect(hasOnboardingMilestone("movement")).toBe(false);
    expect(() => markOnboardingMilestone("movement")).not.toThrow();
    expect(hasOnboardingMilestone("movement")).toBe(true);
  });

  it("ignores unknown values stored under the key", () => {
    fakeStorage.setItem(
      "goldline:onboarding:v1",
      JSON.stringify(["movement", "not_a_real_milestone"])
    );
    expect(hasOnboardingMilestone("movement")).toBe(true);
  });

  it("degrades safely with no window at all", () => {
    delete (globalThis as { window?: unknown }).window;
    expect(hasOnboardingMilestone("movement")).toBe(false);
    expect(() => markOnboardingMilestone("movement")).not.toThrow();
  });
});
