import { describe, expect, it } from "vitest";
import { CLAIRE_CHARACTER_DEFINITION } from "./characterDefinition";
import {
  computeClaireDisclosureTier,
  deriveClaireRelationshipDimensions,
} from "./tierEngine";
import type { ClaireRelationshipEvent } from "./types";

const policy = CLAIRE_CHARACTER_DEFINITION.relationshipPolicy;

function event(
  overrides: Partial<ClaireRelationshipEvent> & {
    id: number;
    eventType: ClaireRelationshipEvent["eventType"];
    occurredAt: string;
  }
): ClaireRelationshipEvent {
  return {
    tenantId: "tenant-1",
    operatorUserId: "operator-1",
    characterId: "claire",
    summary: "event",
    provenance: "test",
    relatedEntityType: null,
    relatedEntityId: null,
    evidenceSource: null,
    createdAt: overrides.occurredAt,
    ...overrides,
  };
}

function daySeries(count: number, type: ClaireRelationshipEvent["eventType"]): ClaireRelationshipEvent[] {
  return Array.from({ length: count }, (_, index) =>
    event({
      id: index + 1,
      eventType: type,
      occurredAt: new Date(2026, 0, index + 1).toISOString(),
    })
  );
}

describe("E — relationship dimensions are derived, never model-writable", () => {
  it("computes dimensions purely from the event log", () => {
    const events = daySeries(3, "operator_follow_through");
    const dims = deriveClaireRelationshipDimensions(events);
    expect(dims.qualifyingInteractionCount).toBe(3);
    expect(dims.distinctInteractionDays).toBe(3);
    expect(dims.professionalRespect).toBeGreaterThan(0);
    expect(dims.reliability).toBeGreaterThan(0);
  });

  it("dimensions move independently — a boundary violation doesn't touch professionalRespect", () => {
    const events = [
      ...daySeries(3, "operator_follow_through"),
      event({ id: 100, eventType: "operator_ignored_boundary", occurredAt: new Date(2026, 1, 1).toISOString() }),
    ];
    const dims = deriveClaireRelationshipDimensions(events);
    expect(dims.professionalRespect).toBeGreaterThan(0);
    expect(dims.disclosureSafety).toBeLessThan(0.001); // clamped at 0 minimum, was negative
  });
});

describe("F — tier thresholds only fire when configured requirements are satisfied", () => {
  it("stays at Tier 0 below the interaction/day threshold", () => {
    const events = daySeries(5, "operator_follow_through");
    const result = computeClaireDisclosureTier(events, policy);
    expect(result.tier).toBe(0);
    expect(result.reasons).toEqual([]);
  });

  it("advances to Tier 1 once interactions and distinct days are both met", () => {
    const events = daySeries(policy.tier0to1.minQualifyingInteractions, "operator_follow_through");
    const result = computeClaireDisclosureTier(events, policy);
    expect(result.tier).toBe(1);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("does not advance to Tier 2 without a meaningful shared event", () => {
    const events = daySeries(policy.tier1to2.minQualifyingInteractions, "operator_follow_through");
    const result = computeClaireDisclosureTier(events, policy);
    expect(result.tier).toBe(1);
  });

  it("advances to Tier 2 with a meaningful shared event present", () => {
    const events = [
      ...daySeries(policy.tier1to2.minQualifyingInteractions - 1, "operator_follow_through"),
      event({
        id: 9999,
        eventType: "shared_hard_win",
        occurredAt: new Date(2026, 5, 1).toISOString(),
      }),
    ];
    const result = computeClaireDisclosureTier(events, policy);
    expect(result.tier).toBe(2);
    expect(result.supportingEventIds).toContain(9999);
  });

  it("G — fail closed: an unresolved ignored boundary blocks Tier 1 even with enough volume", () => {
    const events = [
      ...daySeries(policy.tier0to1.minQualifyingInteractions, "operator_follow_through"),
      event({
        id: 9998,
        eventType: "operator_ignored_boundary",
        occurredAt: new Date(2027, 0, 1).toISOString(),
      }),
    ];
    const result = computeClaireDisclosureTier(events, policy);
    expect(result.tier).toBe(0);
  });

  it("H — tier transition exposes reasons and supporting event ids (no opaque jumps)", () => {
    const events = daySeries(policy.tier0to1.minQualifyingInteractions, "operator_follow_through");
    const result = computeClaireDisclosureTier(events, policy);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(Array.isArray(result.supportingEventIds)).toBe(true);
  });

  it("requires prior Claire disclosure handled well before Tier 3", () => {
    const events = [
      ...daySeries(policy.tier2to3.minQualifyingInteractions - 2, "operator_follow_through"),
      event({ id: 500, eventType: "shared_hard_win", occurredAt: new Date(2030, 0, 1).toISOString() }),
      event({ id: 501, eventType: "operator_respected_boundary", occurredAt: new Date(2030, 0, 2).toISOString() }),
    ];
    const withoutDisclosure = computeClaireDisclosureTier(events, policy);
    expect(withoutDisclosure.tier).toBeLessThan(3);

    const withDisclosure = [
      ...events,
      event({ id: 502, eventType: "claire_disclosure", occurredAt: new Date(2030, 0, 3).toISOString() }),
      event({
        id: 503,
        eventType: "operator_handled_disclosure_well",
        occurredAt: new Date(2030, 0, 4).toISOString(),
      }),
    ];
    const result = computeClaireDisclosureTier(withDisclosure, policy);
    expect(result.tier).toBe(3);
    expect(result.supportingEventIds).toEqual(expect.arrayContaining([502, 503]));
  });
});
