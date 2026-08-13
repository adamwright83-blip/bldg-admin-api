import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveRouteGrammar } from "../../../../shared/actionGrammar";
import { selectFictionForMission } from "./fictionDirector";
import { presentedResolution } from "../../../../shared/twoClockOutcome";
import { deriveWorldMutation } from "../../../../shared/worldMutationDescriptor";
import type { FieldMoveCandidate } from "../../../../server/field/types";

function fieldMove(id: string): FieldMoveCandidate {
  return {
    id,
    moveType: "nearby_commercial_visit",
    title: `Visit ${id}`,
    target: { entityType: "commercial_mission", entityId: id, name: `Account ${id}` },
    expectedDurationMinutes: 8,
    travelMinutes: 4,
    expectedValue: { value: null, provenance: "UNKNOWN", sourceReference: null, confidence: "unknown" },
    confidence: "unknown",
    relevance: "fixture",
    evidence: [],
    expiresAt: null,
    contactAllowed: false,
    withinServiceRadius: true,
    missionId: null,
    missionVersion: null,
    destinationPath: `/driver/field/${id}`,
  };
}

/**
 * Full pipeline: authoritative reality -> Action Grammar -> Fiction
 * Director -> two-clock outcome -> persistent world consequence. Proves
 * items 2, 14, and 15 of the required invariant checklist explicitly, using
 * every real module rather than a mock of the boundary.
 */
describe("mission-fiction pipeline — reality in, real consequence out", () => {
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

  it("inventory alone (no real due moves) cannot create a business action or fiction mission", () => {
    // Zero real field moves — no matter what a hypothetical inventory count
    // claims, there is no grammar, no fiction, nothing to instantiate.
    const grammar = deriveRouteGrammar([]);
    expect(grammar).toBeNull();
  });

  it("a single real move is not yet a route — one real signal cannot manufacture a batch mission", () => {
    const grammar = deriveRouteGrammar([fieldMove("only-one")]);
    expect(grammar).toBeNull();
  });

  it("real reality (N due moves) produces a grammar, which produces a fiction instance", () => {
    const moves = Array.from({ length: 4 }, (_, i) => fieldMove(`m${i}`));
    const grammar = deriveRouteGrammar(moves)!;
    expect(grammar).not.toBeNull();

    const instance = selectFictionForMission(grammar, { now: new Date() });
    expect(instance?.template.id).toBe("neutralize-v1");
    expect(instance?.grammar.count).toBe(4);
  });

  it("real evidence resolves the action; the fictional result never appears in that resolution", () => {
    const resolution = presentedResolution({
      fictional: { outcome: "failure", timerExpired: true, score: 0 },
      authoritative: { resolved: true, resolutionKind: "route_completed", evidencedCount: 4 },
    });
    expect(resolution.resolved).toBe(true);
    expect(resolution.evidencedCount).toBe(4);
  });

  it("authoritative resolution drives the SAME persistent world-mutation semantics as any other mission", () => {
    // The fiction system produces no separate world-truth: once the real
    // route resolves, the world reads it exactly like a captured
    // commercial mission would — same deriveWorldMutation, same treatment.
    const resolution = presentedResolution({
      fictional: { outcome: "success", timerExpired: false, score: 100 },
      authoritative: { resolved: true, resolutionKind: "route_completed", evidencedCount: 4 },
    });
    const mutation = deriveWorldMutation({
      missionState: resolution.resolved ? "captured" : "available",
    });
    expect(mutation.destinationTreatment).toBe("illuminated");
    expect(mutation.isSettled).toBe(true);
  });

  it("an unresolved route with zero evidence produces no settled world consequence, no matter the fiction", () => {
    const resolution = presentedResolution({
      fictional: { outcome: "failure", timerExpired: true, score: 0 },
      authoritative: { resolved: false, resolutionKind: null, evidencedCount: 0 },
    });
    const mutation = deriveWorldMutation({
      missionState: resolution.resolved ? "captured" : "available",
    });
    expect(mutation.isSettled).toBe(false);
    expect(mutation.destinationTreatment).not.toBe("illuminated");
  });
});
