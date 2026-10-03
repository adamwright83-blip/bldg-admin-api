import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";

export type LlmSurface = "voice" | "desktop" | "server";

export type LlmObservabilityContext = {
  tenantId?: string;
  operatorOpenId?: string | null;
  /** Durable conversation key when the product already has one. */
  conversationId?: string | null;
  /** Raw call id when it is distinct from the conversation key. */
  callId?: string | null;
  generationId?: string | null;
  surface?: LlmSurface;
  /**
   * Set by `runWithLlmObservability` for one turn. A caller may pass a trace
   * id it already has. This field is not a conversation id.
   */
  traceId?: string | null;
};

const storage = new AsyncLocalStorage<LlmObservabilityContext>();

/** Characters PostHog accepts on `$ai_trace_id` and `$ai_session_id`. */
const AI_ID_DISALLOWED = /[^A-Za-z0-9\-_~.@( )!':|]/g;

export function posthogAiIdentifier(value: string): string {
  const cleaned = value.replace(AI_ID_DISALLOWED, "_").replace(/\s+/g, "_").slice(0, 200);
  return cleaned || crypto.randomUUID();
}

export function runWithLlmObservability<T>(
  context: LlmObservabilityContext,
  fn: () => Promise<T>
): Promise<T> {
  const parent = storage.getStore();
  const merged: LlmObservabilityContext = { ...parent, ...context };
  if (!merged.traceId?.trim()) {
    merged.traceId = parent?.traceId?.trim() || crypto.randomUUID();
  }
  return storage.run(merged, fn);
}

export function currentLlmObservability(): LlmObservabilityContext | undefined {
  return storage.getStore();
}

export function mergeLlmObservability(
  explicit: LlmObservabilityContext | undefined,
  tenantId: string
): LlmObservabilityContext {
  const current = currentLlmObservability();
  return {
    ...current,
    ...explicit,
    tenantId: explicit?.tenantId || current?.tenantId || tenantId,
    traceId: explicit?.traceId?.trim() || current?.traceId,
  };
}

/**
 * One trace per turn when `runWithLlmObservability` set one. Otherwise each
 * call gets its own id. A conversation id is a session, not a trace, and
 * there is no process-wide trace.
 */
export function llmTraceId(context: LlmObservabilityContext): string {
  return posthogAiIdentifier(context.traceId?.trim() || crypto.randomUUID());
}

/** The product conversation or call, when one already exists. */
export function llmSessionId(context: LlmObservabilityContext): string | undefined {
  const session = context.conversationId?.trim() || context.callId?.trim();
  return session ? posthogAiIdentifier(session) : undefined;
}
