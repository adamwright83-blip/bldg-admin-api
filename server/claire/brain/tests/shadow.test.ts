/**
 * Shadow mode safety.
 *
 * Shadow observation exists to make the two minds comparable. It must be incapable of
 * touching production even when V2 is broken, so these tests attack it rather than
 * merely exercising it.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  clearRecordedObservations,
  compareOutcomes,
  observeShadowTurn,
  observeShadowTurnDetached,
  recordedObservations,
} from "../shadow/observeShadowTurn";
import { createInMemoryShadowMemoryStore, shadowMemoryKey } from "../shadow/shadowMemory";

const CTX = {
  tenantId: "default",
  operatorUserId: "adam-admin",
  surface: "voice" as const,
  conversationKey: "claire-call:shadow",
};

const ON = { CLAIRE_BRAIN_V2_SHADOW: "1" } as unknown as NodeJS.ProcessEnv;
const OFF = {} as unknown as NodeJS.ProcessEnv;

function observe(
  input: Parameters<typeof observeShadowTurn>[0],
  options: Parameters<typeof observeShadowTurn>[1] = {}
) {
  return observeShadowTurn(input, { memory: createInMemoryShadowMemoryStore(), ...options });
}

beforeEach(() => clearRecordedObservations());

describe("shadow mode is off unless explicitly enabled", () => {
  it("does not observe when the flag is unset", async () => {
    const result = await observe({ rawText: "What was my revenue?", ...CTX }, { env: OFF });
    expect(result.observed).toBe(false);
    expect(recordedObservations()).toHaveLength(0);
  });

  it("does not observe on a malformed flag value", async () => {
    const result = await observe(
      { rawText: "What was my revenue?", ...CTX },
      { env: { CLAIRE_BRAIN_V2_SHADOW: "yes-please" } as unknown as NodeJS.ProcessEnv }
    );
    expect(result.observed).toBe(false);
  });

  it("observes when explicitly enabled", async () => {
    const result = await observe({ rawText: "What was my revenue?", ...CTX }, { env: ON });
    expect(result.observed).toBe(true);
    expect(recordedObservations()).toHaveLength(1);
  });
});

describe("shadow observation cannot affect production", () => {
  it("never reports production authority or mutations", async () => {
    const result = await observe({ rawText: "I need to call Dana Tuesday.", ...CTX }, { env: ON });
    expect(result.observed).toBe(true);
    if (result.observed) {
      expect(result.comparison.productionAuthority).toBe(false);
    }
  });

  it("swallows a V2 failure instead of surfacing it into the call", async () => {
    const result = await observe(
      // A malformed turn that makes the runner throw internally.
      { rawText: null as unknown as string, ...CTX },
      { env: ON }
    );
    expect(result.observed).toBe(false);
    if (!result.observed) expect(result.reason).toBe("error");
  });

  it("a throwing sink cannot break observation for the caller", async () => {
    await expect(
      observe(
        { rawText: "Good morning.", ...CTX },
        {
          env: ON,
          sink: () => {
            throw new Error("telemetry store is down");
          },
        }
      )
    ).resolves.toMatchObject({ observed: false, reason: "error" });
  });

  it("the detached entrypoint returns synchronously and never rejects", () => {
    expect(() =>
      observeShadowTurnDetached(
        { rawText: null as unknown as string, ...CTX },
        { env: ON, memory: createInMemoryShadowMemoryStore() }
      )
    ).not.toThrow();
    // Returns void, so a production caller structurally cannot await it.
    expect(
      observeShadowTurnDetached(
        { rawText: "Good morning.", ...CTX },
        { env: ON, memory: createInMemoryShadowMemoryStore() }
      )
    ).toBeUndefined();
  });

  it("an empty utterance is not a semantic turn and does not advance shadow WM", async () => {
    const memory = createInMemoryShadowMemoryStore();
    const key = shadowMemoryKey(CTX);
    await memory.save(key, {
      focusEntities: [],
      orderedQuery: null,
      unresolvedReferences: [],
      priorDecisionRefs: ["BusinessFactSegment"],
      updatedAtMs: 1,
    });
    const result = await observe({ rawText: "   ", ...CTX }, { env: ON, memory });
    expect(result).toEqual({ observed: false, reason: "empty_utterance" });
    expect((await memory.load(key))?.priorDecisionRefs).toEqual(["BusinessFactSegment"]);
  });
});

describe("comparison telemetry is safe and useful", () => {
  it("carries evidence ids and types, not payloads", async () => {
    const result = await observe({ rawText: "What were my last five sales?", ...CTX }, { env: ON });
    expect(result.observed).toBe(true);
    if (result.observed) {
      const serialized = JSON.stringify(result.comparison);
      expect(serialized).not.toMatch(/password|token|secret|DATABASE_URL/i);
      // No raw phone numbers.
      expect(serialized).not.toMatch(/\+?\d{10,}/);
      expect(Array.isArray(result.comparison.evidenceIds)).toBe(true);
      expect(Array.isArray(result.comparison.evidenceTypes)).toBe(true);
    }
  });

  it("flags a call-control disagreement between the two minds", () => {
    expect(
      compareOutcomes({ endCall: true, actionClasses: [] }, { endedCall: false, mutated: false, spokeSomething: true })
    ).toContain("call_control");
    expect(
      compareOutcomes({ endCall: false, actionClasses: [] }, { endedCall: false, mutated: false, spokeSomething: true })
    ).toEqual([]);
  });

  it("flags a mutation V1 performed that V2 claimed no authority for", () => {
    expect(
      compareOutcomes({ endCall: false, actionClasses: [] }, { endedCall: false, mutated: true, spokeSomething: true })
    ).toContain("mutation_authority");
  });

  it("reports no disagreement when V1's outcome is unknown", () => {
    expect(compareOutcomes({ endCall: true, actionClasses: [] }, null)).toEqual([]);
  });
});
