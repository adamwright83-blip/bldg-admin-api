import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkpointStorageKey,
  clearAllCheckpoints,
  clearCheckpoint,
  loadAnyCheckpoint,
  loadCheckpoint,
  saveCheckpoint,
  type Checkpoint,
} from "./checkpointStorage";

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

  const checkpoint = (overrides: Partial<Checkpoint> = {}): Checkpoint => ({
    corridorId: "corridor_01",
    progress: 0.42,
    lateral: 0.1,
    branch: "intel",
    savedAt: "2026-08-11T00:00:00.000Z",
    ...overrides,
  });

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
    saveCheckpoint(checkpoint());
    const loaded = loadCheckpoint("corridor_01");
    expect(loaded?.progress).toBe(0.42);
    expect(loaded?.branch).toBe("intel");
  });

  it("returns null when the saved checkpoint is for a different corridor", () => {
    saveCheckpoint(checkpoint());
    expect(loadCheckpoint("corridor_02")).toBeNull();
  });

  it("survives a corrupted value without throwing", () => {
    fakeStorage.setItem(checkpointStorageKey(null), "{not json");
    expect(() => loadCheckpoint("corridor_01")).not.toThrow();
    expect(loadCheckpoint("corridor_01")).toBeNull();
  });

  it("clearCheckpoint removes the saved value", () => {
    saveCheckpoint(checkpoint());
    clearCheckpoint();
    expect(loadCheckpoint("corridor_01")).toBeNull();
  });

  it("rejects a malformed shape missing required fields", () => {
    fakeStorage.setItem(
      checkpointStorageKey(null),
      JSON.stringify({ corridorId: "corridor_01" })
    );
    expect(loadCheckpoint("corridor_01")).toBeNull();
  });

  describe("cross-corridor continuity", () => {
    it("loadAnyCheckpoint returns the checkpoint whatever corridor it belongs to", () => {
      saveCheckpoint(checkpoint({ corridorId: "corridor_02", progress: 0.6 }));
      const loaded = loadAnyCheckpoint();
      expect(loaded?.corridorId).toBe("corridor_02");
      expect(loaded?.progress).toBe(0.6);
    });

    it("stores which corridor the player was in, so resume can pick the right world", () => {
      saveCheckpoint(checkpoint({ corridorId: "corridor_02" }));
      expect(loadAnyCheckpoint()?.corridorId).toBe("corridor_02");
      // …and the corridor-specific read still refuses a mismatch.
      expect(loadCheckpoint("corridor_01")).toBeNull();
    });
  });

  describe("identity scoping", () => {
    it("does not leak one player's position to another on the same device", () => {
      saveCheckpoint(checkpoint({ progress: 0.7 }), "user-a");
      expect(loadCheckpoint("corridor_01", "user-b")).toBeNull();
      expect(loadCheckpoint("corridor_01", "user-a")?.progress).toBe(0.7);
    });

    it("keeps an anonymous session separate from a signed-in account", () => {
      saveCheckpoint(checkpoint({ progress: 0.3 }), null);
      saveCheckpoint(checkpoint({ progress: 0.9 }), "user-a");
      expect(loadCheckpoint("corridor_01", null)?.progress).toBe(0.3);
      expect(loadCheckpoint("corridor_01", "user-a")?.progress).toBe(0.9);
    });

    it("clearing one identity leaves another identity's checkpoint intact", () => {
      saveCheckpoint(checkpoint(), "user-a");
      saveCheckpoint(checkpoint(), "user-b");
      clearCheckpoint("user-a");
      expect(loadCheckpoint("corridor_01", "user-a")).toBeNull();
      expect(loadCheckpoint("corridor_01", "user-b")).not.toBeNull();
    });

    it("clearAllCheckpoints removes every identity's stored position", () => {
      saveCheckpoint(checkpoint(), "user-a");
      saveCheckpoint(checkpoint(), "user-b");
      saveCheckpoint(checkpoint(), null);
      clearAllCheckpoints();
      expect(loadCheckpoint("corridor_01", "user-a")).toBeNull();
      expect(loadCheckpoint("corridor_01", "user-b")).toBeNull();
      expect(loadCheckpoint("corridor_01", null)).toBeNull();
    });
  });

  describe("no authoritative business state is ever persisted", () => {
    it("drops non-positional fields a caller mistakenly passes in", () => {
      saveCheckpoint({
        ...checkpoint(),
        // None of these belong in local storage; all must be discarded.
        missionState: "captured",
        realizedRevenueCents: 900_000,
        accountId: 42,
        capturedAt: "2026-08-11T00:00:00.000Z",
      } as unknown as Checkpoint);

      const raw = fakeStorage.getItem(checkpointStorageKey(null))!;
      const persisted = JSON.parse(raw) as Record<string, unknown>;

      expect(Object.keys(persisted).sort()).toEqual([
        "branch",
        "corridorId",
        "lateral",
        "progress",
        "savedAt",
      ]);
      expect(persisted).not.toHaveProperty("missionState");
      expect(persisted).not.toHaveProperty("realizedRevenueCents");
      expect(persisted).not.toHaveProperty("accountId");
    });

    it("strips smuggled fields on read as well as on write", () => {
      fakeStorage.setItem(
        checkpointStorageKey(null),
        JSON.stringify({ ...checkpoint(), missionState: "captured" })
      );
      const loaded = loadCheckpoint("corridor_01")!;
      expect(loaded).not.toHaveProperty("missionState");
    });
  });
});
