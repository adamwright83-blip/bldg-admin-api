import { invokeLLM } from "../../_core/llm";
import { ENV } from "../../_core/env";
import type { ConversationTurn } from "../conversation/types";
import { claireDeliveryTranscriptSuffix, isAuthoritativeOperatorTurn } from "../conversation/speechDelivery";
import {
  EVALUATION_JSON_SCHEMA,
  qualitativeEvaluationSchema,
  type QualitativeEvaluation,
} from "./conversationAnalysisSchema";

/**
 * Why an evaluation could not be used. Recorded, not swallowed: an evaluator that fails
 * silently reads as "the conversation passed", which is a false signal.
 */
export type EvaluatorFailureCategory = "empty_output" | "invalid_json" | "schema_mismatch" | "provider_error";

export class MalformedConversationEvaluationError extends Error {
  constructor(
    public readonly category: EvaluatorFailureCategory,
    public readonly detail: string
  ) {
    super(`Malformed conversation evaluation (${category}): ${detail}`);
    this.name = "MalformedConversationEvaluationError";
  }
}

/** Models often wrap strict-JSON output in a code fence; that is recoverable, not malformed. */
export function extractEvaluationJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) throw new MalformedConversationEvaluationError("empty_output", "evaluator returned no content");
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(unfenced);
  } catch (error) {
    throw new MalformedConversationEvaluationError("invalid_json", error instanceof Error ? error.message : "unparseable");
  }
}

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
  const parsed = qualitativeEvaluationSchema.safeParse(extractEvaluationJson(resultText(result)));
  if (!parsed.success) {
    // Field paths only — never the evaluated transcript.
    const paths = Array.from(new Set(parsed.error.issues.map(issue => issue.path.join(".") || "(root)"))).slice(0, 6);
    throw new MalformedConversationEvaluationError("schema_mismatch", paths.join(", "));
  }
  return parsed.data;
}
