/**
 * Goals / Planning adapter — read-only, advisory.
 *
 * Goals may RECOMMEND. They may not act, may not answer, and may not contaminate a
 * scoped question. "What should I do about Dana?" must not become a global board
 * briefing, so a scoped request returns nothing here — the refusal is structural,
 * not a matter of the caller remembering to be careful.
 *
 * Everything emitted is stamped `goal_recommendation`, never `current_business_truth`,
 * so a goal can never license a BusinessFactSegment.
 */

import type { GoalPlanningRequest } from "../contracts/retrieval";
import type { EvidenceItem } from "../contracts/evidence";

export type GoalsContext = {
  tenantId: string;
  operatorUserId: string;
  nowIso: string;
};

export type GoalRecommendation = {
  id: string;
  title: string;
  rationale: string | null;
};

export type GoalsDeps = {
  /** Injected; nothing here reaches the database by default. */
  loadBoardInputs: (ctx: GoalsContext) => Promise<GoalRecommendation[]>;
};

export const noGoals: GoalsDeps = {
  loadBoardInputs: async () => [],
};

export function evidenceFromRecommendation(
  recommendation: GoalRecommendation,
  observedAtIso: string
): EvidenceItem {
  return {
    id: `goal_recommendation:${recommendation.id}`,
    type: "goal_recommendation",
    source: "boardService",
    provenance: { reader: "boardService" },
    observedAt: observedAtIso,
    asOf: observedAtIso,
    freshness: null,
    coverage: null,
    // Advice, not truth. This stamp is what keeps a goal out of a factual claim.
    authoritativeFor: ["goal_recommendation"],
    payload: { title: recommendation.title, rationale: recommendation.rationale },
    operatorVisible: true,
  };
}

export async function retrieveGoalEvidence(
  request: GoalPlanningRequest,
  ctx: GoalsContext,
  deps: GoalsDeps = noGoals
): Promise<EvidenceItem[]> {
  // A scoped turn never sees the global board. This is the Dana guarantee.
  if (request.scoped) return [];
  const recommendations = await deps.loadBoardInputs(ctx);
  return recommendations.map(recommendation => evidenceFromRecommendation(recommendation, ctx.nowIso));
}
