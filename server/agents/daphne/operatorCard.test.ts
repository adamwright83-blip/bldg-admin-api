import { describe, expect, it } from "vitest";
import { compileDaphneOperatorCard } from "./operatorCard";
import type { DaphneMetaPreferenceRecord } from "./goalsPreferences";

function pref(key: DaphneMetaPreferenceRecord["preferenceKey"], value: unknown): DaphneMetaPreferenceRecord {
  return {
    id: key, tenantId: "t", canonicalOperatorId: "o", preferenceKey: key,
    value, version: 1, sourceObservationId: "obs", status: "active",
    createdAt: "2026-10-07T00:00:00Z",
  };
}

describe("Daphne V2 Operator Card", () => {
  it("keeps adaptation disabled after revocation instead of restoring defaults", () => {
    const card=compileDaphneOperatorCard({tenantId:"t",canonicalOperatorId:"o",agentId:"claire",
      generatedAt:new Date(),person:[],state:null,context:null,goals:[],relationship:null,
      metaPreferences:{adaptation_enabled:{...pref("adaptation_enabled",true),status:"revoked"}},
      hypotheses:[],responseModel:[]});
    expect(card.metaPreferences.adaptation_enabled).toBe(false);
  });
  it("is explicitly compiled, noncanonical, and cannot mutate business or narrative truth", () => {
    const card = compileDaphneOperatorCard({
      tenantId: "t", canonicalOperatorId: "o", agentId: "claire",
      generatedAt: new Date("2026-10-07T00:00:00Z"),
      person: [], state: null, context: null, goals: [], relationship: null,
      metaPreferences: {}, hypotheses: [], responseModel: [],
    });
    expect(card.canonical).toBe(false);
    expect(card.guardrails.mayMutateBusinessTruth).toBe(false);
    expect(card.guardrails.mayMintNarrativeDisclosure).toBe(false);
  });

  it("includes active MetaPreference source observations in the compiled evidence chain", () => {
    const card = compileDaphneOperatorCard({
      tenantId: "t", canonicalOperatorId: "o", agentId: "claire",
      generatedAt: new Date("2026-10-07T00:00:00Z"),
      person: [], state: null, context: null, goals: [], relationship: null,
      metaPreferences: { response_detail: pref("response_detail", 0.2) },
      hypotheses: [], responseModel: [],
    });
    expect(card.metaPreferences.response_detail).toBe(0.2);
    expect(card.evidenceRefs).toContain("obs");
  });

  it("obeys explicit disablement of personality inference", () => {
    const card = compileDaphneOperatorCard({
      tenantId: "t", canonicalOperatorId: "o", agentId: "claire",
      generatedAt: new Date(),
      person: [{
        dimension: "directness", mean: .8, variance: .02, observedMin: .6, observedMax: 1,
        sampleCount: 8, distinctContextCount: 3, contextKeys: ["a","b","c"],
        lastObservedAt: "2026-10-07T00:00:00Z", sourceObservationIds: ["1"], epistemicStatus: "active",
      }],
      state: null, context: null, goals: [], relationship: null,
      metaPreferences: { personality_inference: pref("personality_inference", false) },
      hypotheses: [], responseModel: [],
    });
    expect(card.person).toEqual([]);
    expect(card.guardrails.personalityInferenceEnabled).toBe(false);
  });
});
