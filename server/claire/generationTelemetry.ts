import { logAgentEvent } from "../agents/agentEvents";
import { appendClaireGenerationLog } from "./character/generationLog";
import type { ClaireCompiledContext } from "./character/types";

export type ClaireGenerationKind = "opening_brief" | "follow_up";
export type ClaireGenerationSource = "model" | "fallback";
export type ClaireGenerationDiagnostic = {
  kind: ClaireGenerationKind;
  source: ClaireGenerationSource;
  failureReason: string | null;
};

/**
 * Optional richer record for the field-test review tool (Slice 2) and
 * version traceability (Slice 1). Kept separate from ClaireGenerationDiagnostic
 * itself so existing call sites and tests that only know kind/source/failureReason
 * are unaffected — this is additive telemetry, not a shape change.
 */
export type ClaireGenerationReviewDetail = {
  operatorUserId: string | null;
  generatedText: string;
  compiled: ClaireCompiledContext;
  businessContextSummary?: string | null;
};

const counters = new Map<string, { attempts: number; fallbacks: number }>();

export function safeClaireFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/hard limit|spend/i.test(message)) return "spend_limit";
  if (/authentication|api key/i.test(message)) return "authentication_failed";
  if (/rate limit/i.test(message)) return "rate_limited";
  if (/overload/i.test(message)) return "provider_overloaded";
  if (/empty|no assistant text/i.test(message)) return "unusable_output";
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code);
    if (/^[a-z0-9_-]{1,64}$/i.test(code)) return code;
  }
  return "generation_failed";
}

export async function recordClaireGeneration(input: {
  tenantId: string;
  diagnostic: ClaireGenerationDiagnostic;
  latencyMs: number;
  reviewDetail?: ClaireGenerationReviewDetail;
}): Promise<void> {
  const key = `${input.tenantId}:${input.diagnostic.kind}`;
  const current = counters.get(key) ?? { attempts: 0, fallbacks: 0 };
  current.attempts += 1;
  if (input.diagnostic.source === "fallback") current.fallbacks += 1;
  counters.set(key, current);

  const event = {
    event: "claire_generation",
    kind: input.diagnostic.kind,
    source: input.diagnostic.source,
    failureReason: input.diagnostic.failureReason,
    fallbackRate: current.attempts ? current.fallbacks / current.attempts : 0,
  };
  console.info("[Claire] generation", event);
  try {
    await logAgentEvent({
      ctx: {
        tenantId: input.tenantId,
        agentType: "gm_agent",
        actorType: "system",
      },
      toolName: `claire_${input.diagnostic.kind}_generation`,
      status: input.diagnostic.source === "model" ? "success" : "failed",
      outputJson: event,
      errorMessage: input.diagnostic.failureReason,
      latencyMs: input.latencyMs,
    });
  } catch (error) {
    console.warn("[Claire] generation telemetry persistence failed", {
      kind: input.diagnostic.kind,
      reason: safeClaireFailureReason(error),
    });
  }

  if (input.reviewDetail) {
    try {
      await appendClaireGenerationLog({
        tenantId: input.tenantId,
        operatorUserId: input.reviewDetail.operatorUserId,
        generationKind: input.diagnostic.kind,
        generationSource: input.diagnostic.source,
        fallbackReason: input.diagnostic.failureReason,
        generatedText: input.reviewDetail.generatedText,
        compiled: input.reviewDetail.compiled,
        businessContextSummary: input.reviewDetail.businessContextSummary ?? null,
      });
    } catch (error) {
      console.warn("[Claire] generation review-log persistence failed", {
        kind: input.diagnostic.kind,
        reason: safeClaireFailureReason(error),
      });
    }
  }
}

export function getClaireGenerationStats(tenantId: string) {
  const stats = (["opening_brief", "follow_up"] as const).map(kind => {
    const value = counters.get(`${tenantId}:${kind}`) ?? {
      attempts: 0,
      fallbacks: 0,
    };
    return {
      kind,
      ...value,
      fallbackRate: value.attempts ? value.fallbacks / value.attempts : 0,
    };
  });
  return stats;
}
