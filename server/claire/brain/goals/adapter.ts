/**
 * Goals may recommend. They may not act, and they may not contaminate a scoped question.
 */

import type { GoalPlanningRequest } from "../contracts/retrieval";
import type { EvidenceItem } from "../contracts/evidence";

export async function retrieveGoalEvidence(request: GoalPlanningRequest): Promise<EvidenceItem[]> {
  if (request.scoped) return [];
  return [];
}
