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

  it("shows each active preference and goal with the operator's words that set it", () => {
    const obs = (id: string, sourceType: string, payload: Record<string, unknown>) => ({
      id, tenantId: "t", canonicalOperatorId: "o", operatorUserId: "adam-admin", sessionId: null, actorType: "user" as const,
      actorId: "adam-admin", agentId: "claire", observationKind: "preference_declaration" as const, evidenceChannel: "stated" as const,
      verificationStatus: "attested" as const, sourceType, sourceReference: "turn:1", occurredAt: "2026-10-09T00:00:00Z",
      context: null, payload, metadata: null, idempotencyKey: id, createdAt: "2026-10-09T00:00:00Z",
    });
    const card = compileDaphneOperatorCard({
      tenantId: "t", canonicalOperatorId: "o", agentId: "claire", generatedAt: new Date("2026-10-21T00:00:00Z"),
      person: [], state: null, context: null, relationship: null, hypotheses: [], responseModel: [],
      goals: [{ id: "g1", tenantId: "t", canonicalOperatorId: "o", goalKey: "operator_declared_goal", horizon: "near", statement: "maximize sales in Silver Lake",
        priority: 0, constraints: null, status: "active", sourceObservationId: "o2", supersedesGoalId: null, createdAt: "2026-10-10T00:00:00Z", closedAt: null }],
      metaPreferences: { response_detail: { ...pref("response_detail", 0.2), sourceObservationId: "o1" } },
      sourceObservations: [
        obs("o1", "claire_explicit_preference_correction", { preferenceKey: "response_detail", value: 0.2, evidenceText: "Keep your answers shorter." }),
        obs("o2", "claire_conversation_ingestion", { items: [{ kind: "goal", key: "operator_declared_goal", statement: "maximize sales in Silver Lake" }] }),
      ],
    });
    expect(card.activePreferences).toEqual([{ key: "response_detail", value: 0.2, version: 1, since: "2026-10-07T00:00:00Z",
      sourceObservationId: "o1", sourceType: "claire_explicit_preference_correction", sourceUtterance: "Keep your answers shorter." }]);
    expect(card.goalSources[0]).toMatchObject({ statement: "maximize sales in Silver Lake", sourceUtterance: "maximize sales in Silver Lake" });
  });
});
