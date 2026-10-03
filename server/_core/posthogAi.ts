import type { captureAiGeneration as CaptureAiGeneration } from "@posthog/ai";
import crypto from "node:crypto";
import {
  llmSessionId,
  llmTraceId,
  mergeLlmObservability,
  type LlmObservabilityContext,
} from "./llmObservability";
import { getServerPosthog, posthogAiCapturesContent } from "./posthogServer";
import { emitServerLog } from "./posthogLogs";

type CaptureFn = typeof CaptureAiGeneration;

let captureFn: CaptureFn | null | undefined;

async function loadCapture(): Promise<CaptureFn | null> {
  if (captureFn !== undefined) return captureFn;
  try {
    const mod = await import("@posthog/ai");
    captureFn = mod.captureAiGeneration;
  } catch {
    captureFn = null;
  }
  return captureFn;
}

export type AnthropicGenerationRecord = {
  tenantId: string;
  requestedModel: string;
  servedModel?: string | null;
  latencySeconds: number;
  timeToFirstTokenSeconds?: number;
  inputTokens?: number;
  outputTokens?: number;
  stopReason?: string | null;
  completionId?: string | null;
  streamed: boolean;
  temperature?: number;
  maxTokens?: number;
  observability?: LlmObservabilityContext;
  /** Used only when POSTHOG_AI_CAPTURE_CONTENT=1. */
  input?: unknown;
  output?: unknown;
  error?: unknown;
};

function publicAiError(error: unknown): { name: string; message: string; status?: number } {
  if (error instanceof Error) {
    const status =
      "status" in error && typeof (error as { status?: unknown }).status === "number"
        ? (error as { status: number }).status
        : undefined;
    return {
      name: error.name,
      message: error.message.slice(0, 500),
      ...(status !== undefined ? { status } : {}),
    };
  }
  return { name: "Error", message: String(error).slice(0, 500) };
}

/**
 * Records one Anthropic call with PostHog's `$ai_generation` schema.
 * Prompt and response text are omitted unless POSTHOG_AI_CAPTURE_CONTENT=1.
 * Failure here is ignored.
 *
 * The `@posthog/ai` Anthropic client subclass is not used. On the SDK this
 * process runs, `messages.stream()` calls `create().withResponse()`, and that
 * wrapper returns a plain Promise for streaming creates. Replacing the client
 * would break Claire's first-token stream. `captureAiGeneration` is the
 * function that wrapper calls after the official client returns.
 */
export async function recordAnthropicGeneration(record: AnthropicGenerationRecord): Promise<void> {
  try {
    const client = getServerPosthog();
    if (!client) return;
    const capture = await loadCapture();
    if (!capture) return;
    const context = mergeLlmObservability(record.observability, record.tenantId);
    const traceId = llmTraceId(context);
    const sessionId = llmSessionId(context);
    const captureContent = posthogAiCapturesContent();
    const operator = context.operatorOpenId?.trim() || undefined;
    await capture(client, {
      distinctId: operator,
      traceId,
      model: record.servedModel || record.requestedModel,
      provider: "anthropic",
      input: captureContent ? (record.input ?? []) : [],
      output: captureContent ? (record.output ?? []) : [],
      privacyMode: !captureContent,
      latency: record.latencySeconds,
      timeToFirstToken: record.timeToFirstTokenSeconds,
      usage: {
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
      },
      stopReason: record.stopReason ?? undefined,
      completionId: record.completionId ?? undefined,
      modelParameters: {
        requested_model: record.requestedModel,
        ...(record.temperature !== undefined ? { temperature: record.temperature } : {}),
        ...(record.maxTokens !== undefined ? { max_tokens: record.maxTokens } : {}),
        stream: record.streamed,
      },
      properties: {
        tenant_id: context.tenantId,
        surface: context.surface,
        conversation_id: context.conversationId ?? undefined,
        call_id: context.callId ?? undefined,
        generation_id: context.generationId ?? undefined,
        requested_model: record.requestedModel,
        $ai_span_id: crypto.randomUUID(),
        $ai_span_name: record.streamed ? "anthropic.messages.stream" : "anthropic.messages.create",
        // null tells PostHog this call is one trace and not a missing session.
        $ai_session_id: sessionId ?? null,
      },
      ...(context.tenantId ? { groups: { tenant: context.tenantId } } : {}),
      ...(record.error ? { error: publicAiError(record.error) } : {}),
    });
  } catch {
    // Telemetry must not affect the caller.
  }
}

export function logAnthropicProviderFailure(record: {
  tenantId: string;
  requestedModel: string;
  message: string;
}): void {
  emitServerLog("error", "Anthropic request failed", {
    tenant_id: record.tenantId,
    requested_model: record.requestedModel,
    error_message: record.message.slice(0, 500),
  });
}
