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
 *
 * CORRECTIVE PASS: naming this list was not enough on its own.
 * `claireModelRequest` omitting `temperature` from its *return value* did
 * nothing at the provider boundary, because `invokeLLM`/`invokeTextLLM`
 * defaulted a missing `temperature` back to `0` before ever reaching
 * `client.messages.create`. The actual Anthropic request still carried
 * `temperature: 0` regardless of what this file returned, and a Sonnet 5 /
 * Opus 5 request would still 400. The fix is `omitTemperature: true`, a
 * field `invokeLLM`/`invokeTextLLM` check explicitly before deciding whether
 * to send the field at all — see server/_core/llm.ts. This file now returns
 * that flag directly rather than the value that used to (silently) do
 * nothing.
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
 * Model families where extended thinking runs **on by default** when
 * `thinking` is omitted, and where it can be turned back off with
 * `{ type: "disabled" }`.
 *
 * The model Claire runs today (`claude-sonnet-4-6`, and every earlier model)
 * runs with no thinking when `thinking` is omitted. `claude-opus-5` and
 * `claude-sonnet-5` invert that default: omitting `thinking` runs it
 * *adaptively on*. Left alone, switching Claire's configured model to either
 * one would silently add reasoning latency to a live phone call — exactly
 * the kind of confound Slice B must not introduce; that is Slice F's problem,
 * with real measurement, not an accidental side effect of a model swap here.
 *
 * Deliberately excludes Claude Fable 5/5.1 and Claude Mythos 5/5.1: those
 * models run thinking on *unconditionally* and reject
 * `{ type: "disabled" }` with a 400. They are not reachable through this
 * function for that reason — if `ANTHROPIC_MODEL_CLAIRE` is ever set to one
 * of them, this returns `false` and Claire keeps its new (always-on)
 * thinking rather than sending a request that fails outright.
 */
const THINKING_DEFAULT_ON_MODEL_PREFIXES = ["claude-opus-5", "claude-sonnet-5"] as const;

export function claireModelDefaultsToThinking(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return THINKING_DEFAULT_ON_MODEL_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

/**
 * The model plus the request-shaping flags that model actually needs, so
 * that switching `ANTHROPIC_MODEL_CLAIRE` changes only the model — never the
 * sampling behavior or the thinking behavior — as a side effect.
 *
 * Spread into an `invokeLLM` / `invokeTextLLM` call in place of a bare
 * `model` + `temperature` pair:
 *
 *   await invokeText({ tenantId, ...claireModelRequest(0.6), maxTokens, messages })
 *
 * On the model production runs today this returns exactly
 * `{ model, temperature }` — byte-for-byte what every Claire call site sent
 * before this slice.
 */
export function claireModelRequest(temperature: number): {
  model: string;
  temperature?: number;
  omitTemperature?: boolean;
  disableThinking?: boolean;
} {
  const model = claireModelId();
  return {
    model,
    ...(claireModelAcceptsSampling(model) ? { temperature } : { omitTemperature: true }),
    ...(claireModelDefaultsToThinking(model) ? { disableThinking: true } : {}),
  };
}
