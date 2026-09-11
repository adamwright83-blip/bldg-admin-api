/**
 * Slice 4 §5 — the intelligence boundary.
 *
 * The model may explain an already-chosen plan in plain language, drawing
 * only from an allowlist of facts the deterministic layer assembled. It
 * never selects, ranks, or changes the plan. Follows
 * composeAuthoredDayFromBundle's exact pattern (server/nightShift): try
 * Anthropic, validate/parse strictly, fall back deterministically on any
 * failure, log rather than throw.
 */
import { ENV } from "../_core/env";
import { invokeLLM } from "../_core/llm";
import type { MissionPlanOutcome } from "./missionDirectorTypes";

const explainSchema = {
  name: "mission_director_explanation",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["explanation"],
    properties: {
      explanation: { type: "string" },
    },
  },
};

function contentText(result: Awaited<ReturnType<typeof invokeLLM>>): string {
  const content = result.choices[0]?.message.content;
  if (typeof content === "string") return content;
  return (content ?? [])
    .filter(part => part.type === "text")
    .map(part => (part.type === "text" ? part.text : ""))
    .join("");
}

function deterministicExplanation(outcome: MissionPlanOutcome): string {
  if (outcome.status === "planned") {
    return `Primary: ${outcome.primary.title} — ${outcome.primary.objective} Complete when: ${outcome.primary.completionCondition} Fallback if the day changes: ${outcome.fallback.title}.`;
  }
  if (outcome.status === "fallback_only") {
    return `Only the fallback fits today (${outcome.reason.replace(/_/g, " ").toLowerCase()}): ${outcome.fallback.title} — ${outcome.fallback.objective} Complete when: ${outcome.fallback.completionCondition}`;
  }
  return `No mission could be planned today (${outcome.reason.replace(/_/g, " ").toLowerCase()}). ${outcome.remedy}`;
}

/**
 * Returns { explanation, intelligence }. Never mutates the outcome's
 * selection fields — only fills in prose. `outcome` passed in must already
 * have empty explanation strings from planSelection.ts.
 */
export async function explainMissionPlan(input: {
  tenantId: string;
  outcome: MissionPlanOutcome;
}): Promise<{ explanation: string; intelligence: "anthropic" | "deterministic_fallback" }> {
  const fallback = deterministicExplanation(input.outcome);
  if (!ENV.anthropicApiKey?.trim()) {
    return { explanation: fallback, intelligence: "deterministic_fallback" };
  }
  try {
    const result = await invokeLLM({
      tenantId: input.tenantId,
      model: ENV.anthropicModelMissionPlanner,
      maxTokens: 300,
      temperature: 0,
      outputSchema: explainSchema,
      messages: [
        {
          role: "system",
          content:
            "You explain an already-chosen daily growth mission plan in plain, encouraging language for a small-business owner. You do not choose, rank, or change anything — only explain the facts given to you. Never introduce a mission, campaign, customer, time, or fact that is not in the supplied JSON.",
        },
        { role: "user", content: JSON.stringify(input.outcome) },
      ],
    });
    const parsed = JSON.parse(contentText(result));
    if (typeof parsed.explanation !== "string" || !parsed.explanation.trim()) {
      throw new Error("malformed structured output");
    }
    return { explanation: parsed.explanation.trim(), intelligence: "anthropic" };
  } catch (error) {
    console.warn(
      "[MissionDirector] Anthropic explanation unavailable",
      error instanceof Error ? error.message : error
    );
    return { explanation: fallback, intelligence: "deterministic_fallback" };
  }
}
