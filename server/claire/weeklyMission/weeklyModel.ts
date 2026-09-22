/**
 * Optional speech pass through the existing Claire compiler and model client.
 * Malformed output is null. The caller keeps the deterministic draft.
 */

import { ENV } from "../../_core/env";
import { invokeLLM } from "../../_core/llm";
import { WEEKLY_QUESTION_HARD_STOP, WEEKLY_QUESTION_PROPOSE_AT } from "../../../shared/weeklyMissionReadiness";
import { compileClaireCharacterContext } from "../character/compiler";
import { getClaireRelationshipState } from "../character/relationshipState";
import type { WeeklyPlanningDecision } from "./planningDecision";
import type { WeeklyDossier } from "./dossier";
import type { WeeklyPlanningSession } from "./session";

const ACTS = ["ASK", "PROPOSE", "REVISE", "AWAIT_CONFIRMATION", "CANCEL"] as const;

export async function completeWeeklyActWithClaire(input: {
  tenantId: string;
  operatorId: string;
  dossier: WeeklyDossier;
  session: WeeklyPlanningSession;
  operatorUtterance: string;
}): Promise<WeeklyPlanningDecision | null> {
  if (!ENV.anthropicApiKey?.trim()) return null;
  const relationshipState = await getClaireRelationshipState({
    tenantId: input.tenantId,
    operatorUserId: input.operatorId,
  });
  const compiled = compileClaireCharacterContext({
    mode: "weekly_planning",
    relationshipState,
    recentSharedHistory: [],
  });
  const context = {
    horizon: input.dossier.horizon,
    facts: input.dossier.facts.map(fact => ({
      title: fact.title,
      date: fact.businessDate,
      weekday: fact.weekday,
      scheduleLabel: fact.scheduleLabel,
      class: fact.class,
      provenance: fact.provenance,
    })),
    fixedConstraints: input.dossier.fixedConstraints,
    recurrence: input.dossier.facts.filter(fact => fact.class === "recurrence_rule"),
    knownPrep: input.dossier.facts.filter(fact => fact.class === "known_prep"),
    macroGoal: input.dossier.facts.find(fact => fact.class === "macro_goal") ?? null,
    internalHypothesis: input.session.internalHypothesis,
    unresolved: input.session.internalHypothesis.uncertainties.filter(item => item.status === "open"),
    operatorEvidence: input.session.operatorEvidence,
    draft: input.session.draft,
    questionBudget: {
      asked: input.session.substantiveQuestions,
      proposeAt: WEEKLY_QUESTION_PROPOSE_AT,
      hardStop: WEEKLY_QUESTION_HARD_STOP,
    },
    growthCandidates: input.dossier.growthCandidates ?? [],
  };
  try {
    const result = await invokeLLM({
      tenantId: input.tenantId,
      model: ENV.anthropicModelClaire || ENV.anthropicModel,
      maxTokens: 700,
      temperature: 0,
      outputSchema: {
        name: "weekly_planning_decision",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["act", "speech", "hypothesisSummary", "uncertainties", "focusUncertainty", "draftDays"],
          properties: {
            act: { type: "string", enum: [...ACTS] },
            speech: { type: "string" },
            hypothesisSummary: { type: "string" },
            focusUncertainty: { type: ["string", "null"] },
            uncertainties: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["text", "businessDate", "status"],
                properties: {
                  text: { type: "string" },
                  businessDate: { type: ["string", "null"] },
                  status: { type: "string", enum: ["open", "resolved", "killed"] },
                },
              },
            },
            draftDays: {
              type: ["array", "null"],
              items: {
                type: "object",
                additionalProperties: false,
                required: ["businessDate"],
                properties: {
                  businessDate: { type: "string" },
                  primaryText: { type: "string" },
                  readiness: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["text"],
                      properties: {
                        text: { type: "string" },
                        completeByDate: { type: ["string", "null"] },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      messages: [
        {
          role: "system",
          content: [
            compiled.promptSection,
            "You are Claire in weekly_planning. Measured, direct, observant, dry. You are not a coach.",
            "You already did the homework. The private hypothesis is already on the session. Test the highest-value uncertainty.",
            "Do not walk the weekdays in order. Do not ask what the dossier already knows. One question.",
            "Do not open with 'What is the one mission for <weekday>?' when the dossier already has facts.",
            "Say you have enough only when every remaining day has a primary or an explicit stand-down. Never claim the week is locked.",
            "Do not invent buildings, names, addresses, approvals, windows, or customers.",
            "growthCandidates are unconfirmed options. They are not the week.",
            "The hypothesis is private. It is not the proposed week.",
            "Planning context:",
            JSON.stringify(context),
          ].join("\n"),
        },
        {
          role: "user",
          content: input.operatorUtterance || "Begin. Name the rough shape and the one thing you do not trust yet.",
        },
      ],
    });
    const text = contentText(result);
    const parsed = JSON.parse(text) as WeeklyPlanningDecision;
    if (!parsed.speech?.trim() || !ACTS.includes(parsed.act)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function contentText(result: Awaited<ReturnType<typeof invokeLLM>>): string {
  const content = result.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(part => ("text" in part ? part.text : "")).join("");
  }
  return "";
}
