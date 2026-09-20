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
    public readonly detail: string,
    /** Observability for a QA mechanism that previously failed silently. */
    public readonly diagnostics: EvaluatorDiagnostics = { attempts: 1, stopReason: null, truncated: false }
  ) {
    super(`Malformed conversation evaluation (${category}): ${detail}`);
    this.name = "MalformedConversationEvaluationError";
  }
}

export type EvaluatorDiagnostics = {
  attempts: number;
  /** Provider finish reason, when the transport reports one. */
  stopReason: string | null;
  /** The output looked cut off rather than wrong — the September 20 failure mode. */
  truncated: boolean;
  schemaPaths?: string[];
};

/**
 * Did the model run out of room rather than produce something invalid? A max-token stop, or JSON
 * that never closes, means the tail fields (notableMoments, truthfulnessConfidence…) are simply
 * missing. That is worth one bounded retry with more room; a genuinely malformed answer is not.
 */
export function looksTruncated(raw: string, stopReason: string | null): boolean {
  if (stopReason && /max_tokens|length/i.test(stopReason)) return true;
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!trimmed) return false;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const char of trimmed) {
    if (escaped) { escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === "{" || char === "[") depth += 1;
    if (char === "}" || char === "]") depth -= 1;
  }
  return depth > 0 || inString;
}

/** Models often wrap strict-JSON output in a code fence; that is recoverable, not malformed. */
export function extractEvaluationJson(raw: string, diagnostics?: EvaluatorDiagnostics): unknown {
  const trimmed = raw.trim();
  if (!trimmed) throw new MalformedConversationEvaluationError("empty_output", "evaluator returned no content", diagnostics);
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(unfenced);
  } catch (error) {
    throw new MalformedConversationEvaluationError("invalid_json", error instanceof Error ? error.message : "unparseable", diagnostics);
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
  /** Test seam: the first-attempt token budget. */
  maxTokens?: number;
}): Promise<QualitativeEvaluation> {
  const invoke = input.invoke ?? invokeLLM;
  const system = [
    "You are a Goldline product-quality evaluator for completed Claire phone conversations.",
    "You are not Claire and you are not an agent.",
    "Never execute actions, never decide business truth, never invent facts Goldline already supplied.",
    "Use UNKNOWN/null when a judgment cannot be made from the transcript.",
    "Deterministic action counts and NEEDS_DETAILS items are authoritative; do not contradict them.",
    "The live speaker-attributed transcript is primary. A post-call audio transcript, if present, is secondary reconciliation evidence only.",
    "Identify operator corrections, re-explanations vs legitimate clarification, product friction, missing capabilities, and possible unsupported claims as review signals only.",
    "Return the COMPLETE JSON object with every required field. Keep free-text fields short so the object always closes.",
  ].join(" ");
  const user = [
    `Conversation type: ${input.conversationKind}`,
    `Duration: ${input.deterministic.durationLabel}`,
    `Live turns: ${input.deterministic.turnCount}`,
    `Accepted actions (authoritative): ${input.deterministic.acceptedActionCount}`,
    `Completed actions (authoritative): ${input.deterministic.completedActionCount}`,
    `NEEDS_DETAILS (authoritative): ${input.deterministic.needsDetails.join("; ") || "none"}`,
    "",
    "LIVE TRANSCRIPT:",
    input.liveTranscript || "(no live turns)",
    "",
    "POST-CALL AUDIO TRANSCRIPT:",
    input.postCallTranscript || "(none)",
  ].join("\n");

  const attempt = async (maxTokens: number, repairNote: string | null) => {
    let stopReason: string | null = null;
    const result = await invoke({
      tenantId: input.tenantId,
      maxTokens,
      temperature: 0,
      model: ENV.anthropicModel,
      outputSchema: EVALUATION_JSON_SCHEMA,
      onStopReason: (reason: string | null) => { stopReason = reason; },
      messages: [
        { role: "system", content: repairNote ? `${system} ${repairNote}` : system },
        { role: "user", content: user },
      ],
    } as Parameters<typeof invokeLLM>[0]);
    return { raw: resultText(result), stopReason: stopReason as string | null };
  };

  const evaluateOnce = (raw: string, stopReason: string | null, attempts: number): QualitativeEvaluation => {
    const diagnostics: EvaluatorDiagnostics = { attempts, stopReason, truncated: looksTruncated(raw, stopReason) };
    const parsed = qualitativeEvaluationSchema.safeParse(extractEvaluationJson(raw, diagnostics));
    if (!parsed.success) {
      // Field paths only — never the evaluated transcript.
      const paths = Array.from(new Set(parsed.error.issues.map(issue => issue.path.join(".") || "(root)"))).slice(0, 8);
      throw new MalformedConversationEvaluationError("schema_mismatch", paths.join(", "), { ...diagnostics, schemaPaths: paths });
    }
    return parsed.data;
  };

  const first = await attempt(input.maxTokens ?? 1400, null);
  try {
    return evaluateOnce(first.raw, first.stopReason, 1);
  } catch (error) {
    if (!(error instanceof MalformedConversationEvaluationError)) throw error;
    /**
     * ONE bounded repair. The September 20 failure lost exactly the tail fields
     * (notableMoments … truthfulnessConfidence) to a token cap, so the retry gets more room and an
     * explicit instruction. Exactly one — a QA mechanism must not burn budget in a loop.
     */
    const retry = await attempt(Math.max((input.maxTokens ?? 1400) * 2, 2800), "Your previous response was not valid against the schema; return the complete object with every required field and nothing else.");
    try {
      return evaluateOnce(retry.raw, retry.stopReason, 2);
    } catch (retryError) {
      if (retryError instanceof MalformedConversationEvaluationError) {
        throw new MalformedConversationEvaluationError(retryError.category, retryError.detail, { ...retryError.diagnostics, attempts: 2 });
      }
      throw retryError;
    }
  }
}
