export {
  GOAL_METRIC_TYPES,
  getActiveMacroGoal,
  getActiveMacroGoalForOperators,
  resetInMemoryGoalsForTesting,
  setActiveMacroGoal,
  type GoalMetricType,
  type MacroGoal,
  type MacroGoalPersistence,
  type MacroGoalSource,
  type SecondaryTarget,
  type SetActiveMacroGoalInput,
} from "../planning/macroGoalStore";

export function formatGoalVoiceReadback(input: {
  metricKey: string;
  targetValue: number;
  targetDate: string;
}): string {
  const metricLabel = input.metricKey.replace(/_/g, " ");
  return `You confirmed a target of ${input.targetValue} ${metricLabel} by ${input.targetDate}. Did I get that right?`;
}

export function validateVoiceReadbackConfirmation(transcript: string): boolean {
  const normalized = transcript.trim().toLowerCase();
  return (
    /\b(?:yes|correct|that's right|right|confirmed|yep|yeah|sure)\b/i.test(normalized) &&
    !/\b(?:no|not right|incorrect|wrong|wait)\b/i.test(normalized)
  );
}
