import type { DaphneInterventionRecord } from "./interventionLedger";
import type { DaphneOutcomeRecord } from "./outcomeLedger";
import { chooseDaphnePolicyAction, type DaphnePolicyDecision } from "./policyEngine";
import { buildDaphneResponseModel } from "./responseModel";

/**
 * Evidence-gated, read-only outcome feedback for a future policy decision.
 * Observational associations never become causal claims or authorized actions.
 */
export type DaphneLearnedPolicyOption = {
  key: string;
  burden: number;
  relationshipRisk: number;
  preferenceFit: number;
  uncertainty: number;
  hardBlocked?: boolean;
};
export type DaphneLearnedPolicyPreview =
  | { status: "insufficient_evidence"; action: "no_intervention"; epistemicStatus: "association_only";
      missingActions: string[]; sampleCounts: Record<string, number>; evidenceRefs: string[] }
  | { status: "evaluated"; action: string; epistemicStatus: "association_only";
      decision: DaphnePolicyDecision; sampleCounts: Record<string, number>; evidenceRefs: string[] };

export function previewDaphneOutcomeInformedPolicy(input: {
  contextKey: string;
  options: DaphneLearnedPolicyOption[];
  interventions: DaphneInterventionRecord[];
  outcomes: DaphneOutcomeRecord[];
  policyVersion: string;
  minSamplesPerAction?: number;
}): DaphneLearnedPolicyPreview {
  const minSamples = Math.max(2, Math.floor(input.minSamplesPerAction ?? 2));
  if (!input.contextKey.trim() || !input.policyVersion.trim() || !input.options.length) {
    throw new Error("Daphne learned policy requires context, policy version, and options");
  }
  if (new Set(input.options.map(o => o.key)).size !== input.options.length ||
      input.options.some(o => !o.key.trim())) {
    throw new Error("Daphne learned policy requires unique nonempty action keys");
  }
  // Disputed and rejected outcomes must never teach Daphne.
  const eligibleOutcomes = input.outcomes.filter(o =>
    o.verificationStatus === "verified" && o.outcomeClass === "proximal"
  );
  const estimates = buildDaphneResponseModel({
    interventions: input.interventions,
    outcomes: eligibleOutcomes,
    successMeasureKey: "started",
    burdenMeasureKey: "burden",
  });
  const byAction = new Map(estimates
    .filter(e => e.contextKey === input.contextKey)
    .map(e => [e.actionKey, e]));
  const sampleCounts: Record<string, number> = {};
  const missingActions: string[] = [];
  const sourceRefs = new Set<string>();
  const candidates = input.options.map(option => {
    const estimate = byAction.get(option.key);
    sampleCounts[option.key] = estimate?.n ?? 0;
    const supporting = estimate && estimate.n >= minSamples &&
      estimate.expectedProximalOutcome !== null;
    if (!supporting && !option.hardBlocked) missingActions.push(option.key);
    if (supporting) {
      estimate.sourceObservationIds.forEach(ref => sourceRefs.add(ref));
      eligibleOutcomes.filter(o => input.interventions.some(i =>
        i.id === o.interventionId && i.chosenAction === option.key &&
        i.contextKey === input.contextKey
      ) && o.measureKey === "started").forEach(o => sourceRefs.add(o.id));
    }
    return {
      key: option.key,
      proximal: supporting ? estimate.expectedProximalOutcome! : 0,
      // No verified distal causal data has been supplied.
      distal: 0,
      burden: supporting ? estimate.burdenEstimate ?? option.burden : option.burden,
      relationshipRisk: option.relationshipRisk,
      preferenceFit: option.preferenceFit,
      uncertainty: option.uncertainty,
      hardBlocked: option.hardBlocked,
    };
  });
  const evidenceRefs = Array.from(sourceRefs);
  // Do not prefer a measured action over an unmeasured option by pretending
  // missing outcomes are zero: refuse until comparable evidence is available.
  if (missingActions.length || !candidates.some(c => !c.hardBlocked)) {
    return { status: "insufficient_evidence", action: "no_intervention",
      epistemicStatus: "association_only", missingActions, sampleCounts, evidenceRefs };
  }
  const decision = chooseDaphnePolicyAction({
    policyVersion: input.policyVersion,
    candidates,
  });
  return { status: "evaluated", action: decision.action,
    epistemicStatus: "association_only", decision, sampleCounts, evidenceRefs };
}
