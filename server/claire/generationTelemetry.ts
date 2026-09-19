import { logAgentEvent } from "../agents/agentEvents";
import { appendClaireGenerationLog } from "./character/generationLog";
import type { ClaireCompiledContext } from "./character/types";
import type { ClaireDriveContext } from "./contextAssembler";
import type { ClairePromptSizeTrace } from "./answerPathTelemetry";

export type ClaireGenerationKind =
  | "opening_brief"
  | "follow_up"
  | "post_stop_opening"
  | "outcome_confirmation";
export type ClaireGenerationSource = "model" | "fallback";
export type ClaireGenerationDiagnostic = {
  kind: ClaireGenerationKind;
  source: ClaireGenerationSource;
  failureReason: string | null;
  /**
   * PR1 Claire Intelligence Repair (test-matrix items 20/21): the model
   * requested for this generation (e.g. ENV.anthropicModelClaire ||
   * ENV.anthropicModel), so a fallback-rate/model-mix report can be built
   * from these records. Optional and additive -- existing callers that
   * don't pass it are unaffected.
   */
  modelRequested?: string;
  /**
   * Surface this generation served -- "voice" for the Twilio phone call
   * path (the only surface wired to real generation calls today), left
   * optional so a future desktop/text surface can populate it without a
   * shape break. Defaults to "voice" if omitted, since that is the only
   * live surface as of PR1.
   */
  surface?: "voice" | "desktop";
  /**
   * PR1 Claire Intelligence Repair -- corrective pass: Anthropic's raw
   * `stop_reason` ("end_turn", "max_tokens", "stop_sequence", ...),
   * captured via invokeTextLLM's `onStopReason` callback. Lets any future
   * exam or production monitoring positively detect "hit max_tokens"
   * instead of inferring truncation from trailing punctuation. Optional
   * and additive.
   */
  stopReason?: string | null;
  /**
   * Provenance of the final text returned to the operator. Usually "model";
   * "canon_render" means an unsafe personal-model answer was discarded and
   * replaced deterministically from already-eligible canon; "fallback" is
   * the ordinary conservative fallback path.
   */
  answerOrigin?: "model" | "canon_render" | "fallback";
  /**
   * Whether the generous sentence-boundary safety trim actually changed the
   * model output. Null/undefined means no model text was available to assess.
   */
  trimmedToSentenceBoundary?: boolean | null;
  /**
   * Claire Intelligence Repair Part 2, Slice A: the assembled system prompt's
   * size for this generation, with a per-section breakdown. Counts only — no
   * prompt text is recorded. Feeds the Slice E prompt diet's before/after.
   */
  promptSize?: ClairePromptSizeTrace;
  /**
   * The model the provider reported as having answered, next to
   * `modelRequested`. A silent substitution is otherwise indistinguishable
   * from a weak prompt when reading a transcript.
   */
  modelServed?: string | null;
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
  orientationContext?: ClaireDriveContext;
};

const counters = new Map<string, { attempts: number; fallbacks: number }>();

export function safeClaireFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/hard limit|spend/i.test(message)) return "spend_limit";
  if (/authentication|api key/i.test(message)) return "authentication_failed";
  if (/rate limit/i.test(message)) return "rate_limited";
  if (/overload/i.test(message)) return "provider_overloaded";
  if (/empty|no assistant text/i.test(message)) return "unusable_output";
  if (error instanceof Error && error.name === "UngroundedPersonalSpecificityError") {
    return "ungrounded_personal_specificity";
  }
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
    modelRequested: input.diagnostic.modelRequested ?? null,
    surface: input.diagnostic.surface ?? "voice",
    stopReason: input.diagnostic.stopReason ?? null,
    answerOrigin: input.diagnostic.answerOrigin ?? input.diagnostic.source,
    trimmedToSentenceBoundary: input.diagnostic.trimmedToSentenceBoundary ?? null,
    modelServed: input.diagnostic.modelServed ?? null,
    promptChars: input.diagnostic.promptSize?.totalChars ?? null,
    promptSections: input.diagnostic.promptSize?.sections ?? null,
    fallbackRate: current.attempts ? current.fallbacks / current.attempts : 0,
    ...(input.reviewDetail?.orientationContext
      ? orientationTelemetry(input.reviewDetail.orientationContext, input.diagnostic.source === "fallback")
      : {}),
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

export function orientationTelemetry(context: ClaireDriveContext, fallbackUsed: boolean) {
  return {
    businessLocalTimestamp: context.clock
      ? `${context.clock.businessDate} ${context.clock.localTime} ${context.clock.timeZone}`
      : null,
    businessDate: context.clock?.businessDate ?? context.businessDate,
    weekday: context.clock?.weekday ?? null,
    daypart: context.clock?.daypart ?? null,
    fieldSalesDayState: context.clock?.fieldSalesDayState ?? null,
    macroGoalId: context.macroGoal?.id ?? null,
    macroGoalMetricKey: context.macroGoal?.metricKey ?? null,
    macroGoalTargetValue: context.macroGoal?.targetValue ?? null,
    activeCustomerValue: context.verifiedMetrics?.activeCustomers.value ?? null,
    activeCustomerCompleteness: context.verifiedMetrics?.activeCustomers.completeness ?? "unavailable",
    todayItemCounts: context.workPicture?.today.counts ?? null,
    tomorrowItemCounts: context.workPicture?.tomorrow.counts ?? null,
    campaignName: context.campaign?.campaignName ?? null,
    campaignRemainingCount: context.campaign?.remainingCount ?? null,
    pictureSufficient: context.runtime?.picture.sufficient ?? null,
    pictureReason: context.runtime?.picture.reason ?? null,
    needsDetailsCount: context.runtime?.workItems.filter(item => item.detailState === "NEEDS_DETAILS").length ?? 0,
    missionSalesBriefId: context.missionSalesBrief?.briefId ?? null,
    missionSalesBriefVersion: context.missionSalesBrief?.version ?? null,
    fallbackUsed,
  };
}

export function getClaireGenerationStats(tenantId: string) {
  const stats = (
    ["opening_brief", "follow_up", "post_stop_opening", "outcome_confirmation"] as const
  ).map(kind => {
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
