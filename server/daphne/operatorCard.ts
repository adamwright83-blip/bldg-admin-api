import type { DaphnePersonDistribution } from "./personModel";
import type { DaphneFastState } from "./stateModel";
import type { DaphneContext } from "./contextModel";
import type { DaphneGoalRecord, DaphneMetaPreferenceKey, DaphneMetaPreferenceRecord } from "./goalsPreferences";
import type { DaphneRelationship } from "./relationshipModel";
import type { DaphneHypothesisSet } from "./hypothesisSet";

export type DaphneResponseSummary = {
  actionKey: string;
  contextKey: string;
  epistemicStatus: "association_only" | "propensity_supported" | "randomized_supported";
  expectedProximalOutcome: number | null;
  burdenEstimate: number | null;
  sourceClaimIds: string[];
};

export type DaphneOperatorCard = {
  kind: "compiled_daphne_operator_card";
  canonical: false;
  tenantId: string;
  canonicalOperatorId: string;
  agentId: string;
  generatedAt: string;
  person: DaphnePersonDistribution[];
  state: DaphneFastState | null;
  context: DaphneContext | null;
  goals: DaphneGoalRecord[];
  relationship: DaphneRelationship | null;
  metaPreferences: Partial<Record<DaphneMetaPreferenceKey, unknown>>;
  hypotheses: DaphneHypothesisSet[];
  responseModel: DaphneResponseSummary[];
  guardrails: {
    mayMutateBusinessTruth: false;
    mayMintNarrativeDisclosure: false;
    personalityInferenceEnabled: boolean;
    crossAgentSharingEnabled: boolean;
  };
  evidenceRefs: string[];
};

function activePreference(
  preferences: Partial<Record<DaphneMetaPreferenceKey, DaphneMetaPreferenceRecord>>,
  key: DaphneMetaPreferenceKey
): unknown {
  const item = preferences[key];
  return item?.status === "active" ? item.value : undefined;
}

export function compileDaphneOperatorCard(input: {
  tenantId: string;
  canonicalOperatorId: string;
  agentId: string;
  generatedAt: Date;
  person: DaphnePersonDistribution[];
  state: DaphneFastState | null;
  context: DaphneContext | null;
  goals: DaphneGoalRecord[];
  relationship: DaphneRelationship | null;
  metaPreferences: Partial<Record<DaphneMetaPreferenceKey, DaphneMetaPreferenceRecord>>;
  hypotheses: DaphneHypothesisSet[];
  responseModel: DaphneResponseSummary[];
}): DaphneOperatorCard {
  const personalityInferenceEnabled =
    activePreference(input.metaPreferences, "personality_inference") !== false;
  const crossAgentSharingEnabled =
    activePreference(input.metaPreferences, "cross_agent_sharing") === true;

  if (input.relationship && input.relationship.agentId !== input.agentId) {
    throw new Error("Daphne Operator Card relationship must match requested agent");
  }

  const evidenceRefs = new Set<string>();
  for (const item of input.person) item.sourceObservationIds.forEach(id => evidenceRefs.add(id));
  input.state?.sourceObservationIds.forEach(id => evidenceRefs.add(id));
  input.context?.sourceObservationIds.forEach(id => evidenceRefs.add(id));
  input.goals.forEach(item => evidenceRefs.add(item.sourceObservationId));
  Object.values(input.metaPreferences).forEach(item => {
    if (item?.status === "active") evidenceRefs.add(item.sourceObservationId);
  });
  input.relationship?.sourceObservationIds.forEach(id => evidenceRefs.add(id));

  return {
    kind: "compiled_daphne_operator_card",
    canonical: false,
    tenantId: input.tenantId,
    canonicalOperatorId: input.canonicalOperatorId,
    agentId: input.agentId,
    generatedAt: input.generatedAt.toISOString(),
    person: personalityInferenceEnabled ? input.person : [],
    state: input.state,
    context: input.context,
    goals: input.goals,
    relationship: input.relationship,
    metaPreferences: Object.fromEntries(
      Object.entries(input.metaPreferences)
        .filter(([, value]) => value?.status === "active")
        .map(([key, value]) => [key, value!.value])
    ) as Partial<Record<DaphneMetaPreferenceKey, unknown>>,
    hypotheses: personalityInferenceEnabled ? input.hypotheses : [],
    responseModel: input.responseModel,
    guardrails: {
      mayMutateBusinessTruth: false,
      mayMintNarrativeDisclosure: false,
      personalityInferenceEnabled,
      crossAgentSharingEnabled,
    },
    evidenceRefs: Array.from(evidenceRefs),
  };
}
