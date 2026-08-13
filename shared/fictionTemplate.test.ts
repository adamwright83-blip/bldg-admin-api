import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveFictionAssignment,
  eligibleTemplates,
  isTemplateEligible,
  stableMissionKey,
  type FictionTemplate,
} from "./fictionTemplate";
import type { ActionGrammar } from "./actionGrammar";

function grammar(overrides: Partial<ActionGrammar> = {}): ActionGrammar {
  return {
    kind: "PLACE_ITEM_AT_LOCATIONS",
    businessActionId: "route:a,b,c",
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

function template(overrides: Partial<FictionTemplate> = {}): FictionTemplate {
  return {
    id: "fixture-template",
    rulesVersion: 1,
    compatibleGrammarKinds: ["PLACE_ITEM_AT_LOCATIONS"],
    title: "FIXTURE",
    briefing: () => "briefing",
    physicalInstruction: () => "instruction",
    stakes: "stakes",
    successTreatment: { headline: "ok", detail: "ok" },
    failureTreatment: { headline: "ok", detail: "ok" },
    worldReturnTreatment: "none",
    timerEligible: true,
    drivingCompatible: false,
    attentionSafetyClass: "safe_walking",
    humanInteractionCompatible: false,
    ...overrides,
  };
}

describe("isTemplateEligible", () => {
  it("is eligible when the grammar kind matches and safety is compatible", () => {
    expect(isTemplateEligible(template(), grammar())).toBe(true);
  });

  it("rejects a grammar kind the template never declared compatible", () => {
    const t = template({ compatibleGrammarKinds: ["CALL_PERSON"] });
    expect(isTemplateEligible(t, grammar())).toBe(false);
  });

  describe("timer/safety contract", () => {
    it("a timer-eligible, driving-incompatible template cannot bind to a driving grammar", () => {
      const t = template({ timerEligible: true, drivingCompatible: false });
      const g = grammar({ requiresDriving: true });
      expect(isTemplateEligible(t, g)).toBe(false);
    });

    it("a template declared driving-compatible CAN bind to a driving grammar", () => {
      const t = template({ timerEligible: true, drivingCompatible: true });
      const g = grammar({ requiresDriving: true });
      expect(isTemplateEligible(t, g)).toBe(true);
    });

    it("a grammar that is not timer-safe cannot receive a timer-eligible template", () => {
      const t = template({ timerEligible: true });
      const g = grammar({ timerSafe: false });
      expect(isTemplateEligible(t, g)).toBe(false);
    });

    it("a non-timer template is unaffected by driving/timer-safety at all", () => {
      const t = template({ timerEligible: false, drivingCompatible: false });
      const g = grammar({ requiresDriving: true, timerSafe: false });
      expect(isTemplateEligible(t, g)).toBe(true);
    });
  });

  describe("sensitive real conversations", () => {
    it("a sensitive conversation (e.g. a real call) cannot bind to a template not declared compatible", () => {
      const t = template({
        compatibleGrammarKinds: ["CALL_PERSON"],
        humanInteractionCompatible: false,
      });
      const g = grammar({ kind: "CALL_PERSON", sensitiveConversation: true });
      expect(isTemplateEligible(t, g)).toBe(false);
    });

    it("a human-interaction-compatible template CAN bind to a sensitive conversation", () => {
      const t = template({
        compatibleGrammarKinds: ["CALL_PERSON"],
        humanInteractionCompatible: true,
        timerEligible: false,
      });
      const g = grammar({ kind: "CALL_PERSON", sensitiveConversation: true });
      expect(isTemplateEligible(t, g)).toBe(true);
    });
  });
});

describe("determinism", () => {
  const registry = [
    template({ id: "alpha" }),
    template({ id: "bravo" }),
    template({ id: "charlie" }),
  ];

  it("the same stable key always selects the same template — no Math.random() involved", () => {
    const key = stableMissionKey({
      businessActionId: "route:a,b,c",
      occurrenceId: null,
      grammarKind: "PLACE_ITEM_AT_LOCATIONS",
      fictionRulesVersion: 1,
    });
    const runs = Array.from({ length: 50 }, () =>
      deriveFictionAssignment(key, registry, grammar())
    );
    const first = runs[0];
    expect(runs.every(r => r?.templateId === first?.templateId)).toBe(true);
  });

  it("uses no Math.random() or Date-based seed anywhere in the derivation source", () => {
    // Comments are stripped first: this module's own doc comments name the
    // anti-patterns they rule out, and documenting a prohibition must not
    // read as committing it.
    const code = readFileSync(resolve(__dirname, "./fictionTemplate.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/Math\.random/);
    expect(code).not.toMatch(/Date\.now\(\)/);
    expect(code).not.toMatch(/new Date\(\)/);
  });

  it("selection ignores current time entirely — the function accepts no `now` parameter", () => {
    // Structural: deriveFictionAssignment's parameter list is (key, registry,
    // grammar) — nothing time-shaped can be passed even by mistake.
    expect(deriveFictionAssignment.length).toBe(3);
  });

  it("a different unresolved action (different businessActionId) can select a different template", () => {
    const keyA = stableMissionKey({
      businessActionId: "route:x",
      occurrenceId: null,
      grammarKind: "PLACE_ITEM_AT_LOCATIONS",
      fictionRulesVersion: 1,
    });
    const keyB = stableMissionKey({
      businessActionId: "route:y-totally-different",
      occurrenceId: null,
      grammarKind: "PLACE_ITEM_AT_LOCATIONS",
      fictionRulesVersion: 1,
    });
    // Not asserting they MUST differ (hash collisions are legitimate), only
    // that the mechanism is a function of identity, not of nothing.
    const a = deriveFictionAssignment(keyA, registry, grammar());
    const b = deriveFictionAssignment(keyB, registry, grammar());
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });

  it("returns null when nothing is eligible — never forces a fictional mission", () => {
    const key = stableMissionKey({
      businessActionId: "call:1",
      occurrenceId: 1,
      grammarKind: "CALL_PERSON",
      fictionRulesVersion: 1,
    });
    const result = deriveFictionAssignment(
      key,
      registry, // none declare CALL_PERSON compatible
      grammar({ kind: "CALL_PERSON", sensitiveConversation: true })
    );
    expect(result).toBeNull();
  });

  describe("registry evolution cannot silently remap an already-eligible set's relative order", () => {
    it("eligibleTemplates is always sorted by id regardless of registration order", () => {
      const shuffled = [template({ id: "zeta" }), template({ id: "alpha" }), template({ id: "mike" })];
      const sorted = eligibleTemplates(shuffled, grammar());
      expect(sorted.map(t => t.id)).toEqual(["alpha", "mike", "zeta"]);
    });
  });
});

describe("eligibility never depends on narrative content", () => {
  it("the eligibility check touches no field about story", () => {
    const source = readFileSync(resolve(__dirname, "./fictionTemplate.ts"), "utf8");
    const fn = source.slice(
      source.indexOf("export function isTemplateEligible"),
      source.indexOf("export function eligibleTemplates")
    );
    expect(fn).not.toMatch(/briefing|title|stakes/);
  });
});
