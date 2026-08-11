import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearCheckpoint, loadCheckpoint, saveCheckpoint } from "./checkpointStorage";

/** Same fake-window pattern as audioSettings.test.ts / onboardingProgress.test.ts. */
describe("checkpointStorage", () => {
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

  it("returns null when nothing was ever saved", () => {
    expect(loadCheckpoint("corridor_01")).toBeNull();
  });

  it("round-trips a saved checkpoint for the same corridor", () => {
    saveCheckpoint({ corridorId: "corridor_01", progress: 0.42, lateral: 0.1, branch: "intel", savedAt: "2026-08-11T00:00:00.000Z" });
    const loaded = loadCheckpoint("corridor_01");
    expect(loaded?.progress).toBe(0.42);
    expect(loaded?.branch).toBe("intel");
  });

  it("returns null when the saved checkpoint is for a different corridor", () => {
    saveCheckpoint({ corridorId: "corridor_01", progress: 0.42, lateral: 0.1, branch: "intel", savedAt: "2026-08-11T00:00:00.000Z" });
    expect(loadCheckpoint("corridor_02")).toBeNull();
  });

  it("survives a corrupted value without throwing", () => {
    fakeStorage.setItem("goldline:checkpoint:v1", "{not json");
    expect(() => loadCheckpoint("corridor_01")).not.toThrow();
    expect(loadCheckpoint("corridor_01")).toBeNull();
  });

  it("clearCheckpoint removes the saved value", () => {
    saveCheckpoint({ corridorId: "corridor_01", progress: 0.42, lateral: 0.1, branch: "intel", savedAt: "2026-08-11T00:00:00.000Z" });
    clearCheckpoint();
    expect(loadCheckpoint("corridor_01")).toBeNull();
  });

  it("rejects a malformed shape missing required fields", () => {
    fakeStorage.setItem("goldline:checkpoint:v1", JSON.stringify({ corridorId: "corridor_01" }));
    expect(loadCheckpoint("corridor_01")).toBeNull();
  });
});
