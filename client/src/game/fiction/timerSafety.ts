/**
 * Timer/safety contract (Slice 95-102 section 7).
 *
 * A gameplay countdown is allowed only where it makes a safe physical action
 * more exciting. Eligibility is checked twice, at two different times, for
 * two different reasons:
 *
 *   1. BIND TIME — `isTemplateEligible` (shared/fictionTemplate.ts) refuses
 *      to let a timer-eligible template bind to a grammar that requires
 *      driving in the first place. This is permanent, structural.
 *
 *   2. RUN TIME — `shouldPauseTimer` here. Even a walking-route mission
 *      could physically involve a stretch of vehicle travel the grammar
 *      didn't anticipate (e.g. the player legitimately drives between two
 *      distant clusters of an otherwise-walking route). If the runtime signal
 *      says the player is currently driving, the timer pauses — it never
 *      races a screen countdown against someone behind a wheel.
 *
 * Neither function ever accelerates, shortens, or otherwise turns fiction
 * into a real-world deadline. Pausing only ever gives the player MORE real
 * time, never less.
 */
import type { FictionTemplate } from "../../../../shared/fictionTemplate";

export type TimerRuntimeSignal = {
  /** True only from an explicit "currently driving" signal — never inferred from speed guesses. */
  isDriving: boolean;
};

/**
 * Whether a countdown should currently be advancing. False whenever the
 * template was never timer-eligible, or the safety class disallows attention
 * demand right now, or a driving signal is active.
 */
export function shouldAdvanceTimer(
  template: FictionTemplate,
  signal: TimerRuntimeSignal
): boolean {
  if (!template.timerEligible) return false;
  if (template.attentionSafetyClass === "unsafe_while_driving") return false;
  if (signal.isDriving) return false;
  return true;
}

/**
 * Pure decision: should a currently-running timer freeze right now. Distinct
 * from `shouldAdvanceTimer` so a caller can tell "never had a timer" apart
 * from "had one, paused it for safety" in analytics/UI.
 */
export function shouldPauseTimer(
  template: FictionTemplate,
  signal: TimerRuntimeSignal
): boolean {
  return template.timerEligible && signal.isDriving;
}
