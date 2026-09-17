import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eligibleFictionTemplates, selectFictionForMission } from "./fictionDirector";
import { preferredTemplateIdForDirector } from "../../../../shared/behavioralFictionSelection";
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

  it("selects the conversation sanctuary for a real phone call — no timer, no combat", () => {
    const instance = selectFictionForMission(callGrammar(), { now: new Date() });
    expect(instance?.template.id).toBe("world-holds-breath-v1");
    expect(instance?.template.timerEligible).toBe(false);
    expect(instance?.template.humanInteractionCompatible).toBe(true);
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

describe("campaign-preferred templates", () => {
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

  it("uses a campaign-preferred template when it is eligible", () => {
    const alt: FictionTemplate = { ...NEUTRALIZE_TEMPLATE, id: "campaign-route-v1" };
    const instance = selectFictionForMission(routeGrammar(), {
      now: new Date(),
      registry: [NEUTRALIZE_TEMPLATE, alt],
      preferredTemplateId: "campaign-route-v1",
    });
    expect(instance?.template.id).toBe("campaign-route-v1");
  });

  it("ignores a preferred template that is not eligible for this grammar", () => {
    const instance = selectFictionForMission(routeGrammar(), {
      now: new Date(),
      preferredTemplateId: "held-breath-v1",
    });
    expect(instance?.template.id).toBe("neutralize-v1");
  });

  it("selects ghost-echo when the grammar is the chapter's recovery action", () => {
    const grammar: ActionGrammar = {
      kind: "RECOVER_FAILED_CONTACT",
      businessActionId: "recovery:1",
      occurrenceId: null,
      sourceType: "recovery",
      count: 1,
      locations: [],
      channel: "none",
      requiresTravel: false,
      requiresDriving: false,
      timerSafe: false,
      sensitiveConversation: true,
    };
    const instance = selectFictionForMission(grammar, {
      now: new Date(),
      preferredTemplateId: "ghost-echo-v1",
    });
    expect(instance?.template.id).toBe("ghost-echo-v1");
  });
});

describe("production behavioral preferredTemplateId bind", () => {
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

  function visitGrammar(): ActionGrammar {
    return {
      kind: "VISIT_LOCATION",
      businessActionId: "42",
      occurrenceId: 42,
      sourceType: "recovery",
      count: 1,
      locations: ["100 Wilshire"],
      channel: "in_person",
      requiresTravel: true,
      requiresDriving: false,
      timerSafe: true,
      sensitiveConversation: false,
    };
  }

  const walk: FictionTemplate = {
    ...NEUTRALIZE_TEMPLATE,
    id: "beacon-walk-v1",
    compatibleGrammarKinds: ["VISIT_LOCATION"],
    timerEligible: false,
    drivingCompatible: false,
    attentionSafetyClass: "safe_walking",
    humanInteractionCompatible: false,
  };
  const sealed: FictionTemplate = { ...walk, id: "sealed-doors-v1" };
  const registry = [walk, sealed];

  beforeEach(() => {
    store.clear();
    (globalThis as { window?: unknown }).window = { localStorage: fakeStorage };
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("no evidence preserves the existing deterministic fallback", () => {
    const grammar = visitGrammar();
    const before = JSON.stringify(grammar);
    const preferred = preferredTemplateIdForDirector({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      grammar,
      registry,
      events: [],
    });
    expect(preferred.fromBehavioralSelector).toBe(false);
    expect(preferred.preferredTemplateId).toBeNull();
    const instance = selectFictionForMission(grammar, {
      now: new Date(),
      registry,
      preferredTemplateId: preferred.preferredTemplateId,
    });
    expect(JSON.stringify(grammar)).toBe(before);
    expect(instance?.grammar).toBe(grammar);
    expect(["beacon-walk-v1", "sealed-doors-v1"]).toContain(instance?.template.id);
  });

  it("different behavioral evidence can send the same grammar to the Director with a different eligible preferred id", () => {
    const grammar = visitGrammar();
    const lightEvents = [
      {
        tenantId: "tenant-a",
        operatorUserId: "op-a",
        sourceEntityId: "101",
        correlationId: "ops_task:42",
        eventType: "DEFERRED" as const,
      },
      {
        tenantId: "tenant-a",
        operatorUserId: "op-a",
        sourceEntityId: "102",
        correlationId: "ops_task:42",
        eventType: "DEFERRED" as const,
      },
    ];
    const heavyEvents = [
      ...lightEvents,
      {
        tenantId: "tenant-a",
        operatorUserId: "op-a",
        sourceEntityId: "103",
        correlationId: "ops_task:42",
        eventType: "DELIVERED" as const,
      },
      {
        tenantId: "tenant-a",
        operatorUserId: "op-a",
        sourceEntityId: "104",
        correlationId: "ops_task:42",
        eventType: "DELIVERED" as const,
      },
      {
        tenantId: "tenant-a",
        operatorUserId: "op-a",
        sourceEntityId: "105",
        correlationId: "ops_task:42",
        eventType: "DELIVERED" as const,
      },
      {
        tenantId: "tenant-a",
        operatorUserId: "op-a",
        sourceEntityId: "106",
        correlationId: "ops_task:42",
        eventType: "DELIVERED" as const,
      },
    ];
    const lightPref = preferredTemplateIdForDirector({
      grammar,
      registry,
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      events: lightEvents,
      decisionPointId: "dp-light",
    });
    const heavyPref = preferredTemplateIdForDirector({
      grammar,
      registry,
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      events: heavyEvents,
      decisionPointId: "dp-heavy",
    });
    expect(lightPref.fromBehavioralSelector).toBe(true);
    expect(heavyPref.fromBehavioralSelector).toBe(true);
    expect(lightPref.preferredTemplateId).toBeTruthy();
    expect(heavyPref.preferredTemplateId).toBeTruthy();
    expect(lightPref.preferredTemplateId).not.toBe(heavyPref.preferredTemplateId);

    const light = selectFictionForMission(grammar, {
      now: new Date(),
      registry,
      preferredTemplateId: lightPref.preferredTemplateId,
    });
    store.clear();
    const heavy = selectFictionForMission(grammar, {
      now: new Date(),
      registry,
      preferredTemplateId: heavyPref.preferredTemplateId,
    });
    expect(light?.grammar).toBe(grammar);
    expect(heavy?.grammar).toBe(grammar);
    expect(JSON.stringify(light?.grammar)).toBe(JSON.stringify(heavy?.grammar));
    expect(light?.template.id).toBe(lightPref.preferredTemplateId);
    expect(heavy?.template.id).toBe(heavyPref.preferredTemplateId);
    expect(light?.template.id).not.toBe(heavy?.template.id);
  });

  it("Slice 5: Director eligibility still vetoes an ineligible experimental preferred id", () => {
    const grammar = visitGrammar();
    const instance = selectFictionForMission(grammar, {
      now: new Date(),
      registry,
      preferredTemplateId: "world-holds-breath-v1",
    });
    expect(instance?.template.id).not.toBe("world-holds-breath-v1");
    expect(["beacon-walk-v1", "sealed-doors-v1"]).toContain(instance?.template.id);
    expect(JSON.stringify(grammar)).toBe(JSON.stringify(visitGrammar()));
  });
});

describe("eligibleFictionTemplates", () => {
  it("lists NEUTRALIZE for a route grammar", () => {
    const eligible = eligibleFictionTemplates(routeGrammar());
    expect(eligible.map(t => t.id)).toContain("neutralize-v1");
  });

  it("lists the sanctuary template for a sensitive phone-call grammar", () => {
    expect(eligibleFictionTemplates(callGrammar()).map(t => t.id)).toContain(
      "world-holds-breath-v1"
    );
  });
});
