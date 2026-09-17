import type { ActionGrammarKind } from "./actionGrammar";
import { INTERVENTION_DEFINITION_VERSION } from "./behavioralInterventionMapping";
import { STANDARD_PRESENTATION } from "./behavioralInterventionMapping";

export const BEHAVIORAL_EXPERIMENT_POLICY_ID = "presentation_mrt_v1" as const;
export const BEHAVIORAL_EXPERIMENT_POLICY_VERSION = "1" as const;
export const BEHAVIORAL_EXPERIMENT_POLICY_NUMERIC_VERSION = 1 as const;

/**
 * Versioned, inspectable experiment policy. LLM does not author weights.
 * Production remains disabled unless GOLDLINE_BEHAVIORAL_MRT=1.
 */
export type BehavioralExperimentPolicy = {
  id: typeof BEHAVIORAL_EXPERIMENT_POLICY_ID;
  version: typeof BEHAVIORAL_EXPERIMENT_POLICY_VERSION;
  numericVersion: typeof BEHAVIORAL_EXPERIMENT_POLICY_NUMERIC_VERSION;
  enabled: boolean;
  includeStandardPresentation: boolean;
  minEligibleOptions: number;
  equalWeights: true;
  proximalOutcomeWindowMinutes: number;
  eligibleGrammarKinds: readonly ActionGrammarKind[];
  excludeSensitiveConversation: boolean;
  excludeDriving: boolean;
  excludeEmergency: boolean;
  interventionDefinitionVersion: typeof INTERVENTION_DEFINITION_VERSION;
  minSamplePerArmForCausalClaim: number;
};

export const BEHAVIORAL_EXPERIMENT_POLICY_V1: BehavioralExperimentPolicy = {
  id: BEHAVIORAL_EXPERIMENT_POLICY_ID,
  version: BEHAVIORAL_EXPERIMENT_POLICY_VERSION,
  numericVersion: BEHAVIORAL_EXPERIMENT_POLICY_NUMERIC_VERSION,
  enabled: false,
  includeStandardPresentation: true,
  minEligibleOptions: 2,
  equalWeights: true,
  proximalOutcomeWindowMinutes: 120,
  eligibleGrammarKinds: [
    "VISIT_LOCATION",
    "CALL_PERSON",
    "FOLLOW_UP_PERSON",
    "RECOVER_FAILED_CONTACT",
    "INSPECT_LOCATION",
    "WAIT_FOR_EVENT",
    "PLACE_ITEM_AT_LOCATIONS",
  ],
  excludeSensitiveConversation: false,
  excludeDriving: true,
  excludeEmergency: true,
  interventionDefinitionVersion: INTERVENTION_DEFINITION_VERSION,
  minSamplePerArmForCausalClaim: 20,
};

export { STANDARD_PRESENTATION };

export function productionExperimentPolicyEnabled(): boolean {
  return process.env.GOLDLINE_BEHAVIORAL_MRT === "1";
}

export function resolveProductionExperimentPolicy(): BehavioralExperimentPolicy {
  return {
    ...BEHAVIORAL_EXPERIMENT_POLICY_V1,
    enabled: productionExperimentPolicyEnabled(),
  };
}
