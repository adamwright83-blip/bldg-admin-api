import { ENV } from "../../_core/env";
import { invokeLLM } from "../../_core/llm";

export type ClaireConversationTarget =
  | "pending_briefing"
  | "pending_account_follow_up"
  | "pending_action"
  | "weekly_planning"
  | "open_conversation";

export type ClaireConversationDirection = {
  target: ClaireConversationTarget;
  rationale: string;
};

export type ClaireConversationDirectorInput = {
  tenantId: string;
  operatorId: string;
  utterance: string;
  recentTurns: Array<{ speaker: "operator" | "claire"; text: string }>;
  pending: {
    briefing: boolean;
    accountFollowUp: boolean;
    action: boolean;
  };
};

/**
 * Claude owns conversational reference resolution.
 *
 * Persistent workflows are candidates, never authorities. This director answers
 * one question before any stateful executor gets to act: what is the operator
 * actually responding to right now?
 *
 * Deterministic code remains authoritative only for side effects after a target
 * has been selected (writes, receipts, irreversible mutations, call control).
 */
export async function directClaireConversation(
  input: ClaireConversationDirectorInput
): Promise<ClaireConversationDirection | null> {
  if (!ENV.anthropicApiKey?.trim()) return null;

  try {
    const result = await invokeLLM({
      tenantId: input.tenantId,
      model: ENV.anthropicModelClaire || ENV.anthropicModel,
      maxTokens: 180,
      temperature: 0,
      outputSchema: {
        name: "claire_conversation_target",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["target", "rationale"],
          properties: {
            target: {
              type: "string",
              enum: [
                "pending_briefing",
                "pending_account_follow_up",
                "pending_action",
                "weekly_planning",
                "open_conversation",
              ],
            },
            rationale: { type: "string" },
          },
        },
      },
      messages: [
        {
          role: "system",
          content: [
            "You are the conversational control plane for Claire.",
            "Decide what the operator's CURRENT utterance is actually responding to in the live conversation.",
            "Use ordinary human conversational reference. Do not let an older workflow claim speech merely because it can parse the words.",
            "",
            "The possible targets are:",
            "- pending_briefing: the operator is answering/refining Claire's currently held Day Line/work bundle.",
            "- pending_account_follow_up: the operator is answering Claire's currently held account follow-up proposal.",
            "- pending_action: the operator is answering another currently held action/proposal.",
            "- weekly_planning: the operator is deliberately continuing, revising, approving, rejecting, or resuming the weekly-planning conversation.",
            "- open_conversation: everything else: current-day narration, a new topic, a business question, clarification, pushback, chit-chat, or ordinary conversation.",
            "",
            "Critical rules:",
            "1. Short replies such as yes, no, sure, do it, or sounds good bind to the MOST RECENT unresolved question/proposal in the actual conversation.",
            "2. A persisted Weekly Mission is background context. It NEVER owns a reply just because it is open.",
            "3. Choose weekly_planning only when the recent dialogue is actually about the weekly plan or the operator explicitly resumes/references it.",
            "4. If Claire just asked whether to put current work on the Day Line and the operator says yes, that is pending_briefing, even if an old weekly plan is awaiting confirmation.",
            "5. If the operator changes topic, choose open_conversation and leave older workflows parked.",
            "6. When uncertain, choose open_conversation. Safe ambiguity means no stale workflow gets authority.",
            "",
            "Currently held candidates:",
            JSON.stringify(input.pending),
            "",
            "Recent conversation, oldest to newest:",
            JSON.stringify(input.recentTurns.slice(-10)),
          ].join("\n"),
        },
        { role: "user", content: input.utterance },
      ],
    });

    const parsed = JSON.parse(contentText(result)) as Partial<ClaireConversationDirection>;
    if (
      parsed.target !== "pending_briefing" &&
      parsed.target !== "pending_account_follow_up" &&
      parsed.target !== "pending_action" &&
      parsed.target !== "weekly_planning" &&
      parsed.target !== "open_conversation"
    ) {
      return null;
    }

    return {
      target: parsed.target,
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
    };
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
