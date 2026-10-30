/**
 * Business Memory — distance to the operator's headline goal, read-only.
 *
 * The headline goal is always the operator's macro goal (operator_macro_goals,
 * e.g. "Get to 50 active customers"), never a Daphne declared goal or a weekly
 * proposal objective; those are sub-objectives inside it. The figures are current
 * business truth and come from their own readers:
 *
 *   target    operator_macro_goals.targetValue
 *   baseline  macro_goal_runs.baselineValue for the goal's run (23 in prod on 2026-10-20)
 *   current   the verified active-customer metric, only when the goal measures
 *             active customers and that metric is complete; otherwise null, and
 *             Claire says she has no verified current count.
 *   standing  the same count with its completeness, the last day the records
 *             reach and why it may be low (activeCustomerStanding.ts), across
 *             the company's books. Lets Claire say "23 as of the 26th" instead
 *             of nothing when a source is behind.
 *
 * The goals compartment separately carries the objective as advice
 * (`goal_recommendation`). This item lets the plan SPEAK the numbers.
 */


export type GoalProgress = {
  goalId: string;
  objective: string;
  metricKey: string;
  unit: string;
  targetValue: number;
  targetDate: string | null;
  baselineValue: number | null;
  currentValue: number | null;
  /** Why currentValue is null, when it is. */
  currentNote: string | null;
  /** The count read so far, with its caveats. Null when the metric has no standing reader. */
  standing: import("../activeCustomerStanding").ActiveCustomerStanding | null;
};

export type GoalProgressReaders = {
  readMacroGoal: (input: { tenantId: string; operatorUserId: string }) => Promise<{
    id: string;
    objective: string;
    metricKey: string;
    unit: string;
    targetValue: number;
    targetDate: string | null;
  } | null>;
  readRunBaseline: (input: { tenantId: string; macroGoalId: string }) => Promise<number | null>;
  readCurrentValue: (input: { tenantId: string; operatorUserId: string; metricKey: string; now: Date; timeZone: string }) => Promise<{
    value: number | null;
    note: string | null;
    standing?: import("../activeCustomerStanding").ActiveCustomerStanding | null;
  }>;
};

export async function readGoalProgress(
  input: { tenantId: string; operatorUserId: string; now: Date; timeZone: string },
  readers: GoalProgressReaders
): Promise<GoalProgress | null> {
  const goal = await readers.readMacroGoal({ tenantId: input.tenantId, operatorUserId: input.operatorUserId });
  if (!goal) return null;
  const [baseline, current] = await Promise.all([
    readers.readRunBaseline({ tenantId: input.tenantId, macroGoalId: goal.id }).catch(() => null),
    readers
      .readCurrentValue({ tenantId: input.tenantId, operatorUserId: input.operatorUserId, metricKey: goal.metricKey, now: input.now, timeZone: input.timeZone })
      .catch(() => ({ value: null, note: "current count unreadable", standing: null })),
  ]);
  return {
    goalId: goal.id,
    objective: goal.objective.trim(),
    metricKey: goal.metricKey,
    unit: goal.unit,
    targetValue: goal.targetValue,
    targetDate: goal.targetDate,
    baselineValue: baseline,
    currentValue: current.value,
    currentNote: current.value === null ? current.note ?? "no verified current count" : null,
    standing: current.standing ?? null,
  };
}

export const productionGoalProgressReaders: GoalProgressReaders = {
  readMacroGoal: async input => {
    const { getActiveMacroGoal } = await import("../../planning/macroGoalStore");
    const goal = await getActiveMacroGoal(input);
    return goal
      ? {
          id: goal.id,
          objective: goal.objective,
          metricKey: goal.metricKey,
          unit: goal.unit,
          targetValue: goal.targetValue,
          targetDate: goal.targetDate ?? null,
        }
      : null;
  },
  readRunBaseline: async input => {
    const { readMacroGoalRunBaseline } = await import("../../agents/persistentOperator/macroGoalRuns");
    return readMacroGoalRunBaseline(input);
  },
  readCurrentValue: async input => {
    if (input.metricKey !== "active_customers") return { value: null, note: "no verified current count for this goal's metric", standing: null };
    const { getActiveCustomerStanding } = await import("../activeCustomerStanding");
    const standing = await getActiveCustomerStanding({ tenantId: input.tenantId, operatorUserId: input.operatorUserId, now: input.now, timeZone: input.timeZone });
    return standing.complete && standing.value !== null
      ? { value: standing.value, note: null, standing }
      : { value: null, note: standing.caveats.join(" ") || "active-customer count is incomplete", standing };
  },
};


/** "The goal is to get to 50 active customers. It started at 23; I don't have a verified current count." */
export function speakGoalProgress(progress: GoalProgress): string {
  const objective = progress.objective.replace(/[.!]+$/, "");
  const lead = /^(?:get|grow|reach|hit|make|sign|win|double|add)\b/i.test(objective)
    ? `The goal is to ${objective.charAt(0).toLowerCase()}${objective.slice(1)}.`
    : `The goal is ${objective}.`;
  if (progress.currentValue !== null) {
    const left = Math.max(0, progress.targetValue - progress.currentValue);
    return `${lead} You're at ${progress.currentValue}, ${left} to go.`;
  }
  if (progress.baselineValue !== null) {
    return `${lead} It started at ${progress.baselineValue}; I don't have a verified current count.`;
  }
  return `${lead} I don't have a verified current count.`;
}

/** The goal when the operator asks for it directly: same facts, worded as the record. */
export function speakGoalOnRecord(progress: GoalProgress): string {
  const objective = progress.objective.replace(/[.!]+$/, "");
  const distance =
    progress.currentValue !== null
      ? `you're at ${progress.currentValue} of ${progress.targetValue}`
      : progress.baselineValue !== null
        ? `you started at ${progress.baselineValue}, and I still have no verified current count`
        : "I still have no verified current count";
  return `Your goal on record is "${objective}"; ${distance}.`;
}
