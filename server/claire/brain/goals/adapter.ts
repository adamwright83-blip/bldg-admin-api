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
import { loadObligations } from "../../proactive/boardService";

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

/**
 * The operator's standing macro goal (operator_macro_goals), e.g. "Get to 50
 * active customers". Advisory like every goal: it frames a plan, it is not a fact.
 */
export type MacroGoalRecommendation = GoalRecommendation & {
  kind: "macro_goal";
  metricKey: string;
  targetValue: number;
  unit: string;
  targetDate: string | null;
};

export type GoalsDeps = {
  /** Injected; nothing here reaches the database by default. */
  loadBoardInputs: (ctx: GoalsContext) => Promise<GoalRecommendation[]>;
  /** The active macro goal, read only. Absent means not consulted. */
  loadMacroGoal?: (ctx: GoalsContext) => Promise<MacroGoalRecommendation | null>;
};

export const noGoals: GoalsDeps = {
  loadBoardInputs: async () => [],
};

/**
 * Existing board obligations, read only.
 *
 * Deliberately `loadObligations`, NOT `ensureAdamBoard`: the sweep CREATES obligations,
 * and an observer must never create work. This reports what the board already holds.
 */
export const readOnlyGoalsDeps: GoalsDeps = {
  loadBoardInputs: async ctx => {
    const obligations = await loadObligations(ctx.tenantId, ctx.operatorUserId);
    // Only obligations still in play; a superseded or finished one is not advice.
    const live = new Set(["scheduled", "draft_prepared", "awaiting_result"]);
    return obligations
      .filter(obligation => live.has(obligation.status))
      .map(obligation => ({ id: obligation.id, title: obligation.title, rationale: obligation.why }));
  },
  // `getActiveMacroGoal` is a SELECT on operator_macro_goals; it writes nothing.
  loadMacroGoal: async ctx => {
    const { getActiveMacroGoal } = await import("../../../planning/macroGoalStore");
    const goal = await getActiveMacroGoal({ tenantId: ctx.tenantId, operatorUserId: ctx.operatorUserId });
    if (!goal) return null;
    return {
      kind: "macro_goal",
      id: goal.id,
      title: goal.objective,
      rationale: goal.urgencyText ?? null,
      metricKey: goal.metricKey,
      targetValue: goal.targetValue,
      unit: goal.unit,
      targetDate: goal.targetDate ?? null,
    };
  },
};

export function evidenceFromRecommendation(
  recommendation: GoalRecommendation | MacroGoalRecommendation,
  observedAtIso: string
): EvidenceItem {
  const macro = "kind" in recommendation && recommendation.kind === "macro_goal";
  return {
    id: `goal_recommendation:${macro ? "macro_goal:" : ""}${recommendation.id}`,
    type: "goal_recommendation",
    source: macro ? "macroGoalStore" : "boardService",
    provenance: { reader: macro ? "macroGoalStore" : "boardService" },
    observedAt: observedAtIso,
    asOf: observedAtIso,
    freshness: null,
    coverage: null,
    // Advice, not truth. This stamp is what keeps a goal out of a factual claim.
    authoritativeFor: ["goal_recommendation"],
    payload: macro
      ? {
          kind: "macro_goal",
          title: recommendation.title,
          rationale: recommendation.rationale,
          metricKey: (recommendation as MacroGoalRecommendation).metricKey,
          targetValue: (recommendation as MacroGoalRecommendation).targetValue,
          unit: (recommendation as MacroGoalRecommendation).unit,
          targetDate: (recommendation as MacroGoalRecommendation).targetDate,
        }
      : { title: recommendation.title, rationale: recommendation.rationale },
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
  if (request.kind === "macro_goal") {
    if (!deps.loadMacroGoal) return [];
    const goal = await deps.loadMacroGoal(ctx);
    return goal ? [evidenceFromRecommendation(goal, ctx.nowIso)] : [];
  }
  const recommendations = await deps.loadBoardInputs(ctx);
  return recommendations.map(recommendation => evidenceFromRecommendation(recommendation, ctx.nowIso));
}
