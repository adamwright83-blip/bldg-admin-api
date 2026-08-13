import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearFictionAssignment,
  fictionAssignmentStorageKey,
  loadFictionAssignment,
  pruneResolvedFictionAssignments,
  saveFictionAssignmentIfAbsent,
  type FictionAssignmentRecord,
} from "./fictionAssignmentStorage";

describe("fictionAssignmentStorage", () => {
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

  const record = (overrides: Partial<FictionAssignmentRecord> = {}): FictionAssignmentRecord => ({
    stableMissionKey: "route:a,b,c::none::PLACE_ITEM_AT_LOCATIONS::1",
    templateId: "neutralize-v1",
    rulesVersion: 1,
    instantiatedAt: "2026-08-13T00:00:00.000Z",
    ...overrides,
  });

  beforeEach(() => {
    store.clear();
    (globalThis as { window?: unknown }).window = { localStorage: fakeStorage };
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("returns null when no assignment was ever saved", () => {
    expect(loadFictionAssignment("nope")).toBeNull();
  });

  it("round-trips a saved assignment", () => {
    saveFictionAssignmentIfAbsent(record());
    const loaded = loadFictionAssignment(record().stableMissionKey);
    expect(loaded?.templateId).toBe("neutralize-v1");
  });

  it("the first assignment wins — a second save for the same key does not overwrite it", () => {
    saveFictionAssignmentIfAbsent(record({ templateId: "first" }));
    saveFictionAssignmentIfAbsent(record({ templateId: "second" }));
    expect(loadFictionAssignment(record().stableMissionKey)?.templateId).toBe("first");
  });

  it("clearFictionAssignment removes exactly the one mission's record", () => {
    saveFictionAssignmentIfAbsent(record({ stableMissionKey: "keep" }));
    saveFictionAssignmentIfAbsent(record({ stableMissionKey: "drop" }));
    clearFictionAssignment("drop");
    expect(loadFictionAssignment("drop")).toBeNull();
    expect(loadFictionAssignment("keep")).not.toBeNull();
  });

  describe("cross-reload / long-horizon stability", () => {
    it("survives a corrupted stored value without throwing", () => {
      fakeStorage.setItem(fictionAssignmentStorageKey(null), "{not json");
      expect(() => loadFictionAssignment("anything")).not.toThrow();
      expect(loadFictionAssignment("anything")).toBeNull();
    });

    it("drops a malformed record missing required fields", () => {
      fakeStorage.setItem(
        fictionAssignmentStorageKey(null),
        JSON.stringify([{ stableMissionKey: "x" }])
      );
      expect(loadFictionAssignment("x")).toBeNull();
    });
  });

  describe("identity scoping — same pattern as checkpointStorage", () => {
    it("does not leak one player's assignment to another", () => {
      saveFictionAssignmentIfAbsent(record(), "user-a");
      expect(loadFictionAssignment(record().stableMissionKey, "user-b")).toBeNull();
      expect(loadFictionAssignment(record().stableMissionKey, "user-a")).not.toBeNull();
    });
  });

  describe("pruning on long-horizon resume — reality wins", () => {
    it("removes an assignment whose real action is no longer in the still-unresolved set", () => {
      saveFictionAssignmentIfAbsent(record({ stableMissionKey: "resolved" }));
      saveFictionAssignmentIfAbsent(record({ stableMissionKey: "still-open" }));
      const remaining = pruneResolvedFictionAssignments(["still-open"]);
      expect(remaining.map(r => r.stableMissionKey)).toEqual(["still-open"]);
      expect(loadFictionAssignment("resolved")).toBeNull();
    });

    it("keeps everything when every key is still genuinely unresolved", () => {
      saveFictionAssignmentIfAbsent(record({ stableMissionKey: "a" }));
      saveFictionAssignmentIfAbsent(record({ stableMissionKey: "b" }));
      const remaining = pruneResolvedFictionAssignments(["a", "b"]);
      expect(remaining).toHaveLength(2);
    });
  });

  describe("no authoritative business state is ever persisted", () => {
    it("drops non-whitelisted fields a caller mistakenly passes in", () => {
      saveFictionAssignmentIfAbsent({
        ...record(),
        missionState: "captured",
        realizedRevenueCents: 900_000,
      } as unknown as FictionAssignmentRecord);

      const raw = fakeStorage.getItem(fictionAssignmentStorageKey(null))!;
      const persisted = JSON.parse(raw) as Record<string, unknown>[];
      expect(Object.keys(persisted[0]!).sort()).toEqual([
        "instantiatedAt",
        "rulesVersion",
        "stableMissionKey",
        "templateId",
      ]);
    });
  });
});
