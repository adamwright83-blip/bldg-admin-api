/**
 * Whether this turn may even be considered for a Day Line proposal.
 *
 * The work-frame kind is an input. It is not itself a grant. Unknown, failed,
 * strategic work, context narration, and a bare attention repair all fail closed.
 */

import type { PerceivedTurn } from "../contracts/perceivedTurn";

export function dayLineCandidate(perceived: PerceivedTurn): boolean {
  if (perceived.completeness === "incomplete" || perceived.openFragment) return false;
  if (perceived.externalCapability) return false;
  if (perceived.classifierStatus !== "classified") return false;
  if (perceived.explicitMissionWriteRequest) return false;
  if (perceived.refusal) return false;
  if (perceived.workDeclarationKind === "strategic_work") return false;
  if (perceived.workDeclarationKind === "context_narration") return false;
  if (perceived.workDeclarationKind === "none") return false;
  if (perceived.attentionRepair !== "none" && perceived.workDeclarationKind !== "explicit_day_line" && perceived.workDeclarationKind !== "explicit_action" && perceived.workDeclarationKind !== "ordinary_work") {
    return false;
  }
  if (perceived.workDeclarationKind === "explicit_day_line") return true;
  if (perceived.workDeclarationKind === "explicit_action") return perceived.explicitActionRequest;
  if (perceived.workDeclarationKind === "ordinary_work") return perceived.operatorWorkCommitment;
  return false;
}
