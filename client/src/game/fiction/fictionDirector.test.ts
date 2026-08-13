import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eligibleFictionTemplates, selectFictionForMission } from "./fictionDirector";
import type { ActionGrammar } from "../../../../shared/actionGrammar";
import type { FictionTemplate } from "../../../../shared/fictionTemplate";
import { NEUTRALIZE_TEMPLATE } from "./templates/neutralizeTemplate";
import { loadFictionAssignment } from "./fictionAssignmentStorage";

function routeGrammar(overrides: Partial<ActionGrammar> = {}): ActionGrammar {
  return {
    kind: "PLACE_ITEM_AT_LOCATIONS",
    businessActionId: "route:1,2,3",
    occurrenceId: null,
    sourceType: "field_move",
    count: 25,
    locations: Array.from({ length: 25 }, (_, i) => `Stop ${i}`),
    channel: "in_person",
    requiresTravel: true,
    requiresDriving: false,
    timerSafe: true,
    sensitiveConversation: false,
    ...overrides,
  };
}

function callGrammar(): ActionGrammar {
  return {
    kind: "CALL_PERSON",
    businessActionId: "mission:7801",
    occurrenceId: 7801,
    sourceType: "mission",
    count: 1,
    locations: [],
    channel: "phone",
    requiresTravel: false,
    requiresDriving: false,
    timerSafe: false,
    sensitiveConversation: true,
  };
}

describe("selectFictionForMission", () => {
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

  it("selects NEUTRALIZE for a real PLACE_ITEM_AT_LOCATIONS grammar", () => {
    const instance = selectFictionForMission(routeGrammar(), { now: new Date("2026-08-13T00:00:00Z") });
    expect(instance?.template.id).toBe("neutralize-v1");
  });

  it("returns null for a grammar with no eligible template (e.g. a phone call)", () => {
    const instance = selectFictionForMission(callGrammar(), { now: new Date() });
    expect(instance).toBeNull();
  });

  describe("persistence-first determinism", () => {
    it("the same unresolved mission keeps its assignment across separate calls (simulating reload)", () => {
      const first = selectFictionForMission(routeGrammar(), { now: new Date("2026-08-13T00:00:00Z") });
      const second = selectFictionForMission(routeGrammar(), { now: new Date("2026-08-14T00:00:00Z") });
      expect(second?.template.id).toBe(first?.template.id);
      expect(second?.stableMissionKey).toBe(first?.stableMissionKey);
    });

    it("persists the assignment so it can be independently verified in storage", () => {
      const instance = selectFictionForMission(routeGrammar(), { now: new Date() });
      const persisted = loadFictionAssignment(instance!.stableMissionKey);
      expect(persisted?.templateId).toBe("neutralize-v1");
    });

    it("a different businessActionId (a genuinely new mission) is free to receive its own assignment", () => {
      const first = selectFictionForMission(routeGrammar({ businessActionId: "route:A" }), {
        now: new Date(),
      });
      const second = selectFictionForMission(routeGrammar({ businessActionId: "route:B" }), {
        now: new Date(),
      });
      expect(first?.stableMissionKey).not.toBe(second?.stableMissionKey);
    });

    it("registry evolution does not remap an already-instantiated mission's fiction", () => {
      const first = selectFictionForMission(routeGrammar(), { now: new Date() });
      const expandedRegistry: FictionTemplate[] = [
        NEUTRALIZE_TEMPLATE,
        {
          ...NEUTRALIZE_TEMPLATE,
          id: "aaa-new-template-that-sorts-first",
        },
      ];
      const second = selectFictionForMission(routeGrammar(), {
        now: new Date(),
        registry: expandedRegistry,
      });
      expect(second?.template.id).toBe(first?.template.id);
    });

    it("fails safe when a persisted template id no longer exists in the registry", () => {
      selectFictionForMission(routeGrammar(), { now: new Date() });
      const withoutTemplate = selectFictionForMission(routeGrammar(), {
        now: new Date(),
        registry: [],
      });
      expect(withoutTemplate).toBeNull();
    });
  });

  describe("identity scoping", () => {
    it("two different players' instantiation of the same route grammar do not collide", () => {
      const a = selectFictionForMission(routeGrammar(), { now: new Date(), identity: "user-a" });
      // Different identity, but same underlying key — persisted independently.
      const persistedForB = loadFictionAssignment(a!.stableMissionKey, "user-b");
      expect(persistedForB).toBeNull();
    });
  });
});

describe("eligibleFictionTemplates", () => {
  it("lists NEUTRALIZE for a route grammar", () => {
    const eligible = eligibleFictionTemplates(routeGrammar());
    expect(eligible.map(t => t.id)).toContain("neutralize-v1");
  });

  it("lists nothing for a sensitive phone-call grammar (no compatible template registered)", () => {
    expect(eligibleFictionTemplates(callGrammar())).toEqual([]);
  });
});
