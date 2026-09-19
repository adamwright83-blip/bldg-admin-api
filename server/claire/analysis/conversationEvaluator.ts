import { invokeLLM } from "../../_core/llm";
import { ENV } from "../../_core/env";
import type { ConversationTurn } from "../conversation/types";
import { claireDeliveryTranscriptSuffix, isAuthoritativeOperatorTurn } from "../conversation/speechDelivery";
import {
  EVALUATION_JSON_SCHEMA,
  qualitativeEvaluationSchema,
  type QualitativeEvaluation,
} from "./conversationAnalysisSchema";

function resultText(result: Awaited<ReturnType<typeof invokeLLM>>): string {
  const value = result.choices[0]?.message?.content;
  return typeof value === "string" ? value : "";
}

export function formatLiveTranscript(turns: ConversationTurn[]): string {
  return turns
    .filter(turn => turn.speaker !== "OPERATOR" || isAuthoritativeOperatorTurn(turn.providerMetadata))
    .map(turn => {
      const delivery = turn.speaker === "CLAIRE" ? claireDeliveryTranscriptSuffix(turn.providerMetadata) : "";
      return `${turn.ordinal}. ${turn.speaker === "OPERATOR" ? "ADAM" : "CLAIRE"}: ${turn.text}${delivery}`;
    })
    .join("\n");
}

/**
 * Goldline-owned post-call evaluator. Not Claire. Does not mutate business
 * truth, relationship state, or memory.
 */
export async function evaluateConversationQualitative(input: {
  tenantId: string;
  conversationKind: string;
  liveTranscript: string;
  postCallTranscript?: string | null;
  deterministic: {
    durationLabel: string;
    turnCount: number;
    acceptedActionCount: number;
    completedActionCount: number;
    needsDetails: string[];
  };
  invoke?: typeof invokeLLM;
}): Promise<QualitativeEvaluation> {
  const invoke = input.invoke ?? invokeLLM;
  const result = await invoke({
    tenantId: input.tenantId,
    maxTokens: 1400,
    temperature: 0,
    model: ENV.anthropicModel,
    outputSchema: EVALUATION_JSON_SCHEMA,
    messages: [
      {
        role: "system",
        content: [
          "You are a Goldline product-quality evaluator for completed Claire phone conversations.",
          "You are not Claire and you are not an agent.",
          "Never execute actions, never decide business truth, never invent facts Goldline already supplied.",
          "Use UNKNOWN/null when a judgment cannot be made from the transcript.",
          "Deterministic action counts and NEEDS_DETAILS items are authoritative; do not contradict them.",
          "The live speaker-attributed transcript is primary. A post-call audio transcript, if present, is secondary reconciliation evidence only.",
          "Identify operator corrections, re-explanations vs legitimate clarification, product friction, missing capabilities, and possible unsupported claims as review signals only.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          `Conversation type: ${input.conversationKind}`,
          `Duration: ${input.deterministic.durationLabel}`,
          `Live turns: ${input.deterministic.turnCount}`,
          `Accepted actions (authoritative): ${input.deterministic.acceptedActionCount}`,
          `Completed actions (authoritative): ${input.deterministic.completedActionCount}`,
          `NEEDS_DETAILS (authoritative): ${
            input.deterministic.needsDetails.join("; ") || "none"
          }`,
          "",
          "LIVE TRANSCRIPT:",
          input.liveTranscript || "(no live turns)",
          "",
          "POST-CALL AUDIO TRANSCRIPT:",
          input.postCallTranscript || "(none)",
        ].join("\n"),
      },
    ],
  });
  const parsed = qualitativeEvaluationSchema.safeParse(JSON.parse(resultText(result)));
  if (!parsed.success) {
    throw new Error("Malformed conversation evaluation");
  }
  return parsed.data;
}
