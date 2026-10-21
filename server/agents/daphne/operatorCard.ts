import type { DaphnePersonDistribution } from "./personModel";
import type { DaphneFastState } from "./stateModel";
import type { DaphneContext } from "./contextModel";
import type { DaphneGoalRecord, DaphneMetaPreferenceKey, DaphneMetaPreferenceRecord } from "./goalsPreferences";
import type { DaphneRelationship } from "./relationshipModel";
import type { DaphneHypothesisSet } from "./hypothesisSet";
import type { DaphneObservationRecord } from "./observationStore";

/**
 * An active preference or goal with the operator's own words that set it, so a
 * reader can see why Claire behaves as she does (e.g. response_detail 0.2 = shorter
 * answers, set from "keep your answers shorter"). Null utterance means the source
 * observation carries no words (a Desk control) or is no longer readable.
 */
export type DaphneSourcedPreference = {
  key: DaphneMetaPreferenceKey;
  value: unknown;
  version: number;
  since: string;
  sourceObservationId: string;
  sourceType: string | null;
  sourceUtterance: string | null;
};
export type DaphneSourcedGoal = {
  goalId: string;
  statement: string;
  sourceObservationId: string;
  sourceType: string | null;
  sourceUtterance: string | null;
};

/** The operator's words in a source observation, from whichever field its writer used. */
export function daphneSourceUtterance(observation: DaphneObservationRecord | undefined): string | null {
  const p = (observation?.payload ?? {}) as Record<string, unknown>;
  const pick = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 600) : null);
  const items = Array.isArray(p.items) ? (p.items as Array<Record<string, unknown>>) : [];
  return (
    pick(p.evidenceText) ??
    pick(p.utterance) ??
    pick(p.operatorWords) ??
    pick(items.find(i => typeof i.statement === "string")?.statement) ??
    null
  );
}

export type DaphneResponseSummary = {
  actionKey: string;
  contextKey: string;
  epistemicStatus: "association_only" | "propensity_supported" | "randomized_supported";
  expectedProximalOutcome: number | null;
  burdenEstimate: number | null;
  sourceClaimIds: string[];
  sourceObservationIds?: string[];
  sourceOutcomeIds?: string[];
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
  /** Active preferences with the words that set them (plan W6 §9.7). */
  activePreferences: DaphneSourcedPreference[];
  /** Active goals with the words that set them. A Daphne goal is a focus, never the headline. */
  goalSources: DaphneSourcedGoal[];
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
  /** Source observations for preferences and goals, read by exact id. */
  sourceObservations?: DaphneObservationRecord[];
}): DaphneOperatorCard {
  const personalityInferenceEnabled =
    input.metaPreferences.personality_inference?.status !== "revoked" &&
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
  input.hypotheses.forEach(set => set.hypotheses.forEach(h => evidenceRefs.add(h.claimId)));
  input.responseModel.forEach(model => {
    model.sourceClaimIds.forEach(id => evidenceRefs.add(id));
    model.sourceObservationIds?.forEach(id => evidenceRefs.add(id));
    model.sourceOutcomeIds?.forEach(id => evidenceRefs.add(id));
  });

  const sources = new Map((input.sourceObservations ?? []).map(o => [o.id, o]));
  const activePreferences: DaphneSourcedPreference[] = Object.values(input.metaPreferences)
    .filter((p): p is DaphneMetaPreferenceRecord => p?.status === "active")
    .map(p => ({
      key: p.preferenceKey,
      value: p.value,
      version: p.version,
      since: p.createdAt,
      sourceObservationId: p.sourceObservationId,
      sourceType: sources.get(p.sourceObservationId)?.sourceType ?? null,
      sourceUtterance: daphneSourceUtterance(sources.get(p.sourceObservationId)),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const goalSources: DaphneSourcedGoal[] = input.goals.map(g => ({
    goalId: g.id,
    statement: g.statement,
    sourceObservationId: g.sourceObservationId,
    sourceType: sources.get(g.sourceObservationId)?.sourceType ?? null,
    sourceUtterance: daphneSourceUtterance(sources.get(g.sourceObservationId)),
  }));

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
        .filter(([key, value]) => value?.status === "active" ||
          (key === "adaptation_enabled" && value?.status === "revoked"))
        .map(([key, value]) => [key, value!.status === "revoked" ? false : value!.value])
    ) as Partial<Record<DaphneMetaPreferenceKey, unknown>>,
    hypotheses: personalityInferenceEnabled ? input.hypotheses : input.hypotheses
      .filter(set => set.hypotheses.every(h => h.claimType === "direct_fact")),
    responseModel: input.responseModel,
    activePreferences,
    goalSources,
    guardrails: {
      mayMutateBusinessTruth: false,
      mayMintNarrativeDisclosure: false,
      personalityInferenceEnabled,
      crossAgentSharingEnabled,
    },
    evidenceRefs: Array.from(evidenceRefs),
  };
}
