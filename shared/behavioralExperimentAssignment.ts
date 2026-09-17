import type { ActionGrammar } from "./actionGrammar";
import { STANDARD_PRESENTATION } from "./behavioralInterventionMapping";
import type { BehavioralExperimentPolicy } from "./behavioralExperimentPolicy";
import { eligibleTemplates, type FictionTemplate } from "./fictionTemplate";

export type ExperimentSkipReason =
  | "policy_disabled"
  | "missing_identity"
  | "too_few_options"
  | "grammar_not_eligible"
  | "sensitive_conversation"
  | "driving_excluded"
  | "emergency"
  | "unavailable";

export type FrozenExperimentDistribution = {
  options: readonly string[];
  probabilities: readonly number[];
};

/** One intervention occasion. Distinct from the behavioral subject (`ops_task:<id>`). */
export function presentationDecisionPointId(input: {
  correlationId: string;
  occasionId: string;
}): string {
  const correlation = input.correlationId.trim();
  const occasion = input.occasionId.trim();
  return `${correlation}:offer:${occasion}`.slice(0, 128);
}

export function freezeExperimentalOptionSet(input: {
  grammar: ActionGrammar;
  registry: readonly FictionTemplate[];
  policy: BehavioralExperimentPolicy;
  emergency?: boolean;
}): { distribution: FrozenExperimentDistribution | null; skipReason: ExperimentSkipReason | null } {
  if (!input.policy.enabled) {
    return { distribution: null, skipReason: "policy_disabled" };
  }
  if (input.emergency && input.policy.excludeEmergency) {
    return { distribution: null, skipReason: "emergency" };
  }
  if (input.policy.excludeDriving && input.grammar.requiresDriving) {
    return { distribution: null, skipReason: "driving_excluded" };
  }
  if (input.policy.excludeSensitiveConversation && input.grammar.sensitiveConversation) {
    return { distribution: null, skipReason: "sensitive_conversation" };
  }
  if (!input.policy.eligibleGrammarKinds.includes(input.grammar.kind)) {
    return { distribution: null, skipReason: "grammar_not_eligible" };
  }
  const fictionIds = eligibleTemplates(input.registry, input.grammar).map(item => item.id);
  const options = input.policy.includeStandardPresentation
    ? [STANDARD_PRESENTATION, ...fictionIds]
    : [...fictionIds];
  if (options.length < input.policy.minEligibleOptions) {
    return { distribution: null, skipReason: "too_few_options" };
  }
  const probabilities = options.map(() => 1 / options.length);
  return { distribution: { options, probabilities }, skipReason: null };
}

export function distributionSumsToOne(probabilities: readonly number[], epsilon = 1e-9): boolean {
  const sum = probabilities.reduce((acc, value) => acc + value, 0);
  return Math.abs(sum - 1) <= epsilon;
}

export function isValidAssignmentProbability(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= 1;
}

/**
 * Equal-probability draw. `randomInt(n)` must return an integer in [0, n).
 * Do not use a hash here — that is deterministic_policy.
 */
export function drawEqualProbabilityArm(input: {
  options: readonly string[];
  randomInt: (n: number) => number;
}): { assignedOption: string; assignmentProbability: number } {
  if (input.options.length === 0) {
    throw new Error("Cannot draw an experimental arm from an empty option set");
  }
  const index = input.randomInt(input.options.length);
  if (index < 0 || index >= input.options.length || !Number.isInteger(index)) {
    throw new Error("randomInt must return an integer in [0, n)");
  }
  return {
    assignedOption: input.options[index]!,
    assignmentProbability: 1 / input.options.length,
  };
}

export function preferredTemplateIdFromAssignedOption(assignedOption: string): string | null {
  if (assignedOption === STANDARD_PRESENTATION) return null;
  return assignedOption;
}

export type ExperimentalAssignmentRecord = {
  decisionPointId: string;
  correlationId: string;
  availability: boolean;
  eligibleOptions: readonly string[];
  assignedOption: string;
  assignmentMechanism: "randomized_assignment";
  assignmentProbability: number;
  interventionPolicyVersion: number;
  interventionDefinitionVersion: number;
  proximalOutcomeWindowMinutes: number;
  preferredTemplateId: string | null;
  persisted: boolean;
};
