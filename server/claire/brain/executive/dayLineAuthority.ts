/**
 * Whether this turn may even be considered for a Day Line proposal.
 *
 * The work-frame kind is an input. It is not itself a grant. Unknown, failed,
 * strategic work, context narration, and a bare attention repair all fail closed.
 *
 * Day Line is not a sink for every action. An explicit Day Line request may
 * propose. A first-person operator plan ("I need to call them Tuesday") may
 * propose. An imperative or other explicit action aimed at Claire
 * ("Call them.", "Schedule the pickup.") is recognized elsewhere and mints
 * no Day Line grant.
 */

import type { PerceivedTurn } from "../contracts/perceivedTurn";

/**
 * The operator describing their own plan. An imperative with no first person
 * ("Call them.") does not match, even when a work verb is present.
 */
const FIRST_PERSON_PLAN =
  /\b(?:i|we)\b(?:\s+[a-z']+){0,4}?\s+(?:need\s+to|have\s+to|gotta|got\s+to|must|should|will|'ll|plan\s+to|want\s+to|(?:am|'m|are|'re)\s+going\s+to)\s+\w+|\b(?:i'm|i\s+am|we're|we\s+are)\s+\w+ing\b/i;

export function dayLineCandidate(perceived: PerceivedTurn): boolean {
  if (perceived.completeness === "incomplete" || perceived.openFragment) return false;
  if (perceived.externalCapability) return false;
  if (perceived.classifierStatus !== "classified") return false;
  if (perceived.explicitMissionWriteRequest) return false;
  if (perceived.refusal) return false;
  if (perceived.workDeclarationKind === "strategic_work") return false;
  if (perceived.workDeclarationKind === "context_narration") return false;
  if (perceived.workDeclarationKind === "none") return false;
  if (
    perceived.attentionRepair !== "none" &&
    perceived.workDeclarationKind !== "explicit_day_line" &&
    perceived.workDeclarationKind !== "explicit_action" &&
    perceived.workDeclarationKind !== "ordinary_work"
  ) {
    return false;
  }
  if (perceived.workDeclarationKind === "explicit_day_line") return true;
  if (perceived.workDeclarationKind === "explicit_action") return false;
  if (perceived.workDeclarationKind === "ordinary_work") {
    return perceived.operatorWorkCommitment && FIRST_PERSON_PLAN.test(perceived.assembledText);
  }
  return false;
}
