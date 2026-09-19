/**
 * Claire Intelligence Repair Part 2, Slice B: one model authority for Claire.
 *
 * Every model call that materially participates in answering the operator
 * resolves its model here, and nowhere else. Before this file, PR 1 had set
 * the Claire-specific override on two call sites; eight others silently
 * inherited `ENV.anthropicModel`, so configuring `ANTHROPIC_MODEL_CLAIRE`
 * would have moved part of Claire and left the rest behind.
 *
 * The authority is deliberately not a model identifier. Which model
 * production runs is an environment decision (`ANTHROPIC_MODEL_CLAIRE`), not
 * a source-code constant.
 *
 * Not Claire's: Day Director, sales-intel extraction, vendor onboarding,
 * mission planning, field-journal processing, conversation analysis. Those
 * are separate Goldline consumers with their own model choices and are
 * deliberately left on `ENV.anthropicModel`.
 */

import { ENV } from "../_core/env";

/**
 * The single model authority for Claire's answer pipeline.
 * `ANTHROPIC_MODEL_CLAIRE`, else `ANTHROPIC_MODEL`, else the built-in default.
 */
export function claireModelId(): string {
  return ENV.anthropicModelClaire || ENV.anthropicModel;
}

/**
 * Model families that reject `temperature` / `top_p` / `top_k` with a 400.
 *
 * This matters far more than it looks. Every Claire call site passes a
 * temperature (0 for the extractors and planners, 0.1-0.6 for the spoken
 * paths). On the current-generation models those parameters were removed from
 * the Messages API, so simply setting `ANTHROPIC_MODEL_CLAIRE` to one of them
 * would make every Claire generation throw — and Claire fails closed, so the
 * operator would hear the canned conservative fallback on every single turn,
 * with nothing in the call itself to explain why.
 *
 * Matching is by prefix on the model family, so dated or suffixed variants of
 * the same family are covered. Anything not listed keeps its temperature, so
 * the behavior of the model production runs today is byte-for-byte unchanged.
 * An unlisted family that does reject sampling degrades to exactly the
 * pre-existing failure mode — a logged fallback, never a wrong answer — and
 * the Slice A telemetry records the failure reason.
 */
const SAMPLING_REJECTING_MODEL_PREFIXES = [
  "claude-fable-5",
  "claude-mythos-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-sonnet-5",
] as const;

export function claireModelAcceptsSampling(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return !SAMPLING_REJECTING_MODEL_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

/**
 * The model plus the sampling parameters that model will actually accept.
 *
 * Spread into an `invokeLLM` / `invokeTextLLM` call in place of a bare
 * `model` + `temperature` pair:
 *
 *   await invokeText({ tenantId, ...claireModelRequest(0.6), maxTokens, messages })
 */
export function claireModelRequest(temperature: number): {
  model: string;
  temperature?: number;
} {
  const model = claireModelId();
  return claireModelAcceptsSampling(model) ? { model, temperature } : { model };
}
