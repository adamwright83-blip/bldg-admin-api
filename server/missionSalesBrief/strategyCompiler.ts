import { z } from "zod";
import { invokeLLM } from "../_core/llm";
import type {
  MissionSalesBriefFact,
  MissionSalesBriefIntelReference,
  MissionSalesBriefRecommendedApproach,
  MissionSalesBriefUnknown,
} from "../../shared/missionSalesBrief";
import type { MissionSalesBriefEvidence } from "./evidenceAssembler";

export const STRATEGY_COMPILER_VERSION = "mission-sales-brief-compiler-1";

const strategySchema = z.object({
  primaryObjective: z.string().trim().min(1).max(240),
  recommendedOpening: z.string().trim().max(280).nullable(),
  questionsToAsk: z.array(z.string().trim().min(1).max(240)).max(5),
  actionsToTake: z.array(z.string().trim().min(1).max(240)).max(5),
  thingsToAvoid: z.array(z.string().trim().min(1).max(240)).max(5),
  successDefinition: z.string().trim().min(1).max(280),
  unknowns: z
    .array(
      z.object({
        question: z.string().trim().min(1).max(240),
        reason: z.string().trim().min(1).max(240),
      })
    )
    .max(5),
});

const STRATEGY_JSON_SCHEMA = {
  name: "mission_sales_strategy",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      primaryObjective: { type: "string", maxLength: 240 },
      recommendedOpening: { type: ["string", "null"], maxLength: 280 },
      questionsToAsk: { type: "array", items: { type: "string", maxLength: 240 }, maxItems: 5 },
      actionsToTake: { type: "array", items: { type: "string", maxLength: 240 }, maxItems: 5 },
      thingsToAvoid: { type: "array", items: { type: "string", maxLength: 240 }, maxItems: 5 },
      successDefinition: { type: "string", maxLength: 280 },
      unknowns: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            question: { type: "string", maxLength: 240 },
            reason: { type: "string", maxLength: 240 },
          },
          required: ["question", "reason"],
        },
      },
    },
    required: [
      "primaryObjective",
      "recommendedOpening",
      "questionsToAsk",
      "actionsToTake",
      "thingsToAvoid",
      "successDefinition",
      "unknowns",
    ],
  },
} as const;

export type StrategyCompilationResult = {
  recommendedApproach: MissionSalesBriefRecommendedApproach;
  unknowns: MissionSalesBriefUnknown[];
  source: "model" | "fallback";
  confidence: number;
};

function compactEvidenceForPrompt(input: {
  evidence: MissionSalesBriefEvidence;
  knownFacts: MissionSalesBriefFact[];
  intel: MissionSalesBriefIntelReference | null;
}): string {
  return JSON.stringify({
    accountName: input.evidence.mission.account.name,
    accountType: input.evidence.mission.account.accountType,
    missionStatus: input.evidence.mission.status,
    existingBrief: input.evidence.mission.brief,
    knownFacts: input.knownFacts.map(fact => fact.text),
    priorOutcomes: input.evidence.priorOutcomes.map(fact => fact.text),
    currentVisitOutcome: input.evidence.currentVisitOutcome,
    selectedSalesIntel: input.intel
      ? { title: input.intel.title, category: input.intel.category }
      : null,
  });
}

/**
 * Deterministic fallback strategy — used whenever the model is unavailable
 * or fails, and always available as ground truth even when the model
 * succeeds is checked against it. Never invents anything not already in
 * the evidence: it reuses the mission's existing static brief and the
 * fact that outcome/objection information is simply not yet known.
 */
export function deterministicFallbackStrategy(
  evidence: MissionSalesBriefEvidence
): StrategyCompilationResult {
  const staticBrief = evidence.mission.brief;
  const hasOutcome = Boolean(evidence.currentVisitOutcome);
  const unknowns: MissionSalesBriefUnknown[] = hasOutcome
    ? []
    : [
        {
          question: "What is actually blocking this account from moving forward?",
          reason: "No visit outcome or objection has been recorded for this mission yet.",
        },
      ];
  return {
    recommendedApproach: {
      primaryObjective: hasOutcome
        ? "Follow up on the recorded outcome and take the next concrete step."
        : "Learn what is actually blocking this account, rather than repeating the introductory pitch.",
      recommendedOpening: hasOutcome ? null : staticBrief?.openingLine ?? null,
      questionsToAsk: hasOutcome
        ? []
        : (staticBrief?.discoveryQuestions ?? []).slice(0, 3),
      actionsToTake: [],
      thingsToAvoid: evidence.priorOutcomes.length
        ? ["Repeating the full introductory pitch this account has already heard."]
        : [],
      successDefinition: hasOutcome
        ? "A concrete next step is confirmed."
        : "The real blocker or next decision-maker step is identified.",
    },
    unknowns,
    source: "fallback",
    confidence: 0.4,
  };
}

/**
 * Compiles the recommended-approach + unknowns from eligible evidence
 * (Slice 6). The model may recommend, question, and select at most one
 * eligible framework — it may never invent an objection, decision maker,
 * relationship, competitor, or outcome, and its output is validated
 * against the source evidence rather than trusted blindly. Falls back to
 * the deterministic strategy on any failure so the operator's workday is
 * never blocked by a model failure.
 */
export async function compileMissionSalesStrategy(input: {
  tenantId: string;
  evidence: MissionSalesBriefEvidence;
  knownFacts: MissionSalesBriefFact[];
  intel: MissionSalesBriefIntelReference | null;
  invoke?: typeof invokeLLM;
}): Promise<StrategyCompilationResult> {
  const invoke = input.invoke ?? invokeLLM;
  const fallback = deterministicFallbackStrategy(input.evidence);
  try {
    const result = await invoke({
      tenantId: input.tenantId,
      maxTokens: 700,
      temperature: 0.2,
      outputSchema: STRATEGY_JSON_SCHEMA,
      messages: [
        {
          role: "system",
          content: [
            "You compile a sales-mission strategy for a field operator from ONLY the supplied evidence.",
            "You may never invent an objection, a decision maker, a relationship, a competitor, a prior conversation, or a business outcome that is not in the evidence.",
            "A recommendation is a suggestion, never a fact. Do not phrase a recommendation as something that already happened.",
            "If the evidence does not name a real blocker/objection, treat that as unknown and say so in `unknowns` — do not guess one.",
            "If prior outcomes show the account has already heard the introductory pitch, thingsToAvoid must include not repeating it from scratch.",
            "If a sales intel item was supplied, you may use it to shape the recommendation's style, but it never overrides or invents business facts.",
            "Keep every field short and concrete — this is spoken/read by a field operator, not a report.",
          ].join(" "),
        },
        {
          role: "user",
          content: compactEvidenceForPrompt({
            evidence: input.evidence,
            knownFacts: input.knownFacts,
            intel: input.intel,
          }),
        },
      ],
    });
    const text = result.choices[0]?.message?.content;
    const parsed = strategySchema.safeParse(
      JSON.parse(typeof text === "string" ? text : "")
    );
    if (!parsed.success) return fallback;
    return {
      recommendedApproach: {
        primaryObjective: parsed.data.primaryObjective,
        recommendedOpening: parsed.data.recommendedOpening,
        questionsToAsk: parsed.data.questionsToAsk,
        actionsToTake: parsed.data.actionsToTake,
        thingsToAvoid: parsed.data.thingsToAvoid,
        successDefinition: parsed.data.successDefinition,
      },
      unknowns: parsed.data.unknowns,
      source: "model",
      confidence: 0.75,
    };
  } catch {
    return fallback;
  }
}
