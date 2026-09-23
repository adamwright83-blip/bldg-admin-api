import { describe, expect, it } from "vitest";
import { markPrologueSeen, prologueKey, shouldPlayPrologue, type PrologueStorage } from "./colosseumPrologue";

function memoryStorage(): PrologueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

describe("the Colosseum prologue plays once, and only while it tells the truth", () => {
  it("plays on a fresh device before any real outcome, then never again", () => {
    const storage = memoryStorage();
    expect(shouldPlayPrologue(storage, "mission-a", 0)).toBe(true);
    markPrologueSeen(storage, "mission-a");
    expect(storage.data.get(prologueKey("mission-a"))).toBe("1");
    expect(shouldPlayPrologue(storage, "mission-a", 0)).toBe(false);
  });

  it("never plays once a real outcome exists: it ends with five intact seals", () => {
    expect(shouldPlayPrologue(memoryStorage(), "mission-b", 1)).toBe(false);
    expect(shouldPlayPrologue(memoryStorage(), "mission-b", 5)).toBe(false);
  });

  it("does not replay this session even when the device refuses to store it", () => {
    const refusing: PrologueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(shouldPlayPrologue(refusing, "mission-c", 0)).toBe(true);
    markPrologueSeen(refusing, "mission-c");
    expect(shouldPlayPrologue(refusing, "mission-c", 0)).toBe(false);
  });

  it("skips rather than loops when storage cannot be read", () => {
    const unreadable: PrologueStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => undefined,
    };
    expect(shouldPlayPrologue(unreadable, "mission-d", 0)).toBe(false);
    expect(shouldPlayPrologue(null, "mission-d", 0)).toBe(false);
  });
});
