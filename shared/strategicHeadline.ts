import type { StrategicDiagnosis } from "./strategicIntelligence";

/**
 * One goal, not two (repair plan §3, D18). When the operating mandate has a
 * leading outcome (the confirmed primary, or the sole active macro goal in
 * operator_macro_goals), that goal is the week's headline. An area focus, whether
 * confirmed or only mentioned (a Daphne operator_declared_goal is filed as a focus),
 * qualifies the headline and never replaces it. Returns null when there is no
 * leading macro goal, so callers keep their existing wording.
 */
export function weeklyHeadlineObjective(
  diagnosis: Pick<StrategicDiagnosis, "goal" | "objective" | "mandate">
): string | null {
  const ref = diagnosis.goal.evidenceRef ?? "";
  if (!ref.startsWith("operator_macro_goals:")) return null;
  if (diagnosis.mandate && diagnosis.mandate.leadingOutcomeId == null) return null;
  const goal = diagnosis.goal.statement.trim().replace(/[.\s]+$/, "");
  const focus = diagnosis.objective;
  if (!focus?.area) return goal;
  return focus.confirmation === "inferred" ? `${goal} (starting in ${focus.area})` : `${goal}, focused on ${focus.area}`;
}
