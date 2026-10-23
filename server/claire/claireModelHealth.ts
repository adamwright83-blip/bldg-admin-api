/**
 * Can Claire think before she dials?
 *
 * 2026-10-22: the production Anthropic key was revoked overnight. The 5:30 PM evening wrap still dialled,
 * ran on templates, read a recovered $160 customer as a revenue re-query three times, then said "Sorry, I
 * lost that" twice. Nothing told Adam the key was dead. A scheduled call now asks the model for one token
 * first; a rejected key skips the call and texts the operator why. Anything else (overloaded, timeout) is a
 * blip, and the call goes ahead on the existing fallbacks.
 */
import { invokeLLM } from "../_core/llm";
import { claireModelRequest } from "./claireModel";

export type ClaireModelHealth = { ok: true } | { ok: false; reason: "authentication_failed"; detail: string };

const AUTH_FAILURE = /authentication failed|invalid x-api-key|\b401\b/i;

export async function checkClaireModelHealth(input: {
  tenantId: string;
  invoke?: typeof invokeLLM;
}): Promise<ClaireModelHealth> {
  try {
    await (input.invoke ?? invokeLLM)({
      tenantId: input.tenantId,
      ...claireModelRequest(0),
      maxTokens: 1,
      timeoutMs: 15_000,
      feature: "claire_model_preflight",
      messages: [{ role: "user", content: "Reply with OK." }],
    });
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return AUTH_FAILURE.test(detail) ? { ok: false, reason: "authentication_failed", detail: detail.slice(0, 200) } : { ok: true };
  }
}

export function claireModelDownText(purpose: string): string {
  const call = purpose === "morning_readiness" ? "morning call" : purpose === "evening_debrief" ? "evening wrap" : "call";
  return `Claire skipped your ${call}: her AI model rejected the API key (401), so she couldn't understand you on a call. Replace ANTHROPIC_API_KEY in Railway and she'll call on schedule again.`;
}
