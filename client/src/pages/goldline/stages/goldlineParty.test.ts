import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PARTY_CHANGED_EVENT,
  PARTY_COMPANIONS,
  isTravelingWith,
  joinParty,
  loadParty,
  partyKey,
} from "./goldlineParty";
import { colosseumResolutionKey, markColosseumResolved } from "./waywardProgress";

const store = new Map<string, string>();
let fakeWindow: EventTarget & { localStorage: Storage };

beforeEach(() => {
  store.clear();
  fakeWindow = Object.assign(new EventTarget(), {
    localStorage: {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (key: string) => store.get(key) ?? null,
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      removeItem: (key: string) => void store.delete(key),
      setItem: (key: string, value: string) => void store.set(key, value),
    } as Storage,
  });
  (globalThis as { window?: unknown }).window = fakeWindow;
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("the Goldline party", () => {
  it("starts empty: nobody travels with her before the Colosseum resolves", () => {
    expect(loadParty("driver-1").members).toEqual([]);
    expect(isTravelingWith("driver-1", "rook")).toBe(false);
  });

  it("records Rook joining in this device's storage, per player, and tells whoever is listening", () => {
    const heard: string[] = [];
    fakeWindow.addEventListener(PARTY_CHANGED_EVENT, event =>
      heard.push((event as CustomEvent<{ id: string }>).detail.id)
    );
    const party = joinParty("driver-1", "rook", new Date("2026-09-22T20:00:00Z"));
    expect(party.members).toEqual([
      { id: "rook", joinedVia: "kingdom-1-colosseum", joinedAt: "2026-09-22T20:00:00.000Z" },
    ]);
    expect(isTravelingWith("driver-1", "rook")).toBe(true);
    expect(isTravelingWith("driver-2", "rook")).toBe(false);
    expect(JSON.parse(store.get(partyKey("driver-1"))!)).toEqual({ members: party.members });
    expect(heard).toEqual(["rook"]);
  });

  it("is idempotent: joining again keeps the first record and stays quiet", () => {
    joinParty("driver-1", "rook", new Date("2026-09-22T20:00:00Z"));
    let events = 0;
    fakeWindow.addEventListener(PARTY_CHANGED_EVENT, () => (events += 1));
    const again = joinParty("driver-1", "rook", new Date("2026-10-01T00:00:00Z"));
    expect(again.members).toHaveLength(1);
    expect(again.members[0]!.joinedAt).toBe("2026-09-22T20:00:00.000Z");
    expect(events).toBe(0);
  });

  it("gives Rook to anyone who resolved the Colosseum before the party existed", () => {
    markColosseumResolved("veteran");
    expect(store.get(colosseumResolutionKey("veteran"))).toBe("1");
    expect(loadParty("veteran").members).toEqual([
      { id: "rook", joinedVia: "kingdom-1-colosseum", joinedAt: null },
    ]);
    expect(isTravelingWith("veteran", "rook")).toBe(true);
  });

  it("ignores anything in storage that is not a known companion", () => {
    store.set(
      partyKey("driver-1"),
      JSON.stringify({ members: [{ id: "mara" }, { id: "rook", joinedVia: "somewhere-else" }, { id: "rook" }, 7] })
    );
    expect(loadParty("driver-1").members).toEqual([
      { id: "rook", joinedVia: "kingdom-1-colosseum", joinedAt: null },
    ]);
    store.set(partyKey("driver-2"), "{not json");
    expect(loadParty("driver-2").members).toEqual([]);
  });

  it("survives a device that refuses to store it", () => {
    fakeWindow.localStorage.setItem = () => {
      throw new Error("quota");
    };
    expect(() => joinParty("driver-1", "rook")).not.toThrow();
  });

  it("names Rook's mechanic CONTACT and ties it to his real capability, nothing wider", () => {
    expect(PARTY_COMPANIONS.rook.mechanic).toBe("CONTACT");
    // The capability must be the one the protected roster seeds for Rook.
    const seed = readFileSync(join(__dirname, "../../../../../server/companions/seedCompanions.ts"), "utf8");
    const rook = seed.slice(seed.indexOf('companionId: "rook"'), seed.indexOf('companionId: "bront"'));
    expect(rook).toContain(`abilityId: "${PARTY_COMPANIONS.rook.capabilityId}"`);
  });
});
