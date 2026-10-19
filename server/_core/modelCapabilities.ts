/**
 * Request-shaping rules per Claude model family.
 *
 * Every Anthropic request in this server goes through `server/_core/llm.ts`.
 * The current-generation models reject request fields older models accepted,
 * so a model swap must never depend on each caller remembering the right
 * flags. `llm.ts` applies these rules itself, from the model it is about to
 * call, whatever the caller passed.
 *
 *   field                      sonnet-5-5   opus-5-5   haiku-5-5   opus-5 / sonnet-5   4.x
 *   temperature                400          400        400         400                 ok
 *   thinking {type:"disabled"} 400          400        ok          ok                  ok
 *   thinking off form          between_tools  (none)   disabled    disabled            omit
 *   forced tool_choice         400          400        ok          ok                  ok
 *
 * Opus 5.5 (and Fable / Mythos 5.x) cannot turn thinking off at all; the
 * latency control there is `output_config.effort: "low"`.
 */

/**
 * The current-generation Sonnet. `llm.ts` shapes every request for it (no
 * temperature, `between_tools` instead of disabled thinking, `auto` instead of
 * forced tool choice), so callers need no flags.
 */
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";
export const CURRENT_HAIKU_MODEL = "claude-haiku-5-5";

/**
 * Previous-generation ids that may still be configured in an environment.
 * They resolve to the current generation so no Claire or JOYSTICK surface keeps
 * answering on an older model because a stale variable was never updated.
 */
const RETIRED_ANTHROPIC_MODEL_REPLACEMENTS: Record<string, string> = {
  "claude-sonnet-4-20250514": DEFAULT_ANTHROPIC_MODEL,
  "claude-sonnet-4-5": DEFAULT_ANTHROPIC_MODEL,
  "claude-sonnet-4-6": DEFAULT_ANTHROPIC_MODEL,
  "claude-haiku-4-5": CURRENT_HAIKU_MODEL,
  "claude-haiku-4-5-20251001": CURRENT_HAIKU_MODEL,
};

export function normalizeAnthropicModel(raw: string): string {
  return RETIRED_ANTHROPIC_MODEL_REPLACEMENTS[raw] ?? raw;
}

function normalized(model: string): string {
  return model.trim().toLowerCase();
}

function startsWithAny(model: string, prefixes: readonly string[]): boolean {
  const value = normalized(model);
  return prefixes.some(prefix => value.startsWith(prefix));
}

/** Families whose Messages API rejects `temperature` / `top_p` / `top_k`. */
const SAMPLING_REJECTING_PREFIXES = [
  "claude-fable-5",
  "claude-mythos-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-sonnet-5",
  "claude-haiku-5",
] as const;

export function modelAcceptsSampling(model: string): boolean {
  return !startsWithAny(model, SAMPLING_REJECTING_PREFIXES);
}

/** Thinking runs when `thinking` is omitted. */
const THINKING_DEFAULT_ON_PREFIXES = [
  "claude-fable-5",
  "claude-mythos-5",
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-haiku-5",
] as const;

export function modelDefaultsToThinking(model: string): boolean {
  return startsWithAny(model, THINKING_DEFAULT_ON_PREFIXES);
}

/** Thinking cannot be switched off; only effort lowers its cost. */
const THINKING_ALWAYS_ON_PREFIXES = [
  "claude-fable-5",
  "claude-mythos-5",
  "claude-opus-5-5",
] as const;

/** `{type:"disabled"}` is a 400; `{type:"between_tools"}` is the off form. */
const BETWEEN_TOOLS_OFF_PREFIXES = ["claude-sonnet-5-5"] as const;

export type ThinkingOffShape =
  | { kind: "omit" }
  | { kind: "param"; thinking: { type: "disabled" } | { type: "between_tools" } }
  | { kind: "low_effort" };

/**
 * How to ask `model` for an answer without extended reasoning latency.
 * Models that never think by default need nothing sent.
 */
export function thinkingOffShape(model: string): ThinkingOffShape {
  if (!modelDefaultsToThinking(model)) return { kind: "omit" };
  if (startsWithAny(model, THINKING_ALWAYS_ON_PREFIXES)) return { kind: "low_effort" };
  if (startsWithAny(model, BETWEEN_TOOLS_OFF_PREFIXES)) {
    return { kind: "param", thinking: { type: "between_tools" } };
  }
  return { kind: "param", thinking: { type: "disabled" } };
}

/** `tool_choice` `{type:"tool"}` / `{type:"any"}` returns a 400. */
const FORCED_TOOL_REJECTING_PREFIXES = [
  "claude-fable-5-1",
  "claude-mythos-5-1",
  "claude-opus-5-5",
  "claude-sonnet-5-5",
] as const;

export function modelAcceptsForcedToolChoice(model: string): boolean {
  return !startsWithAny(model, FORCED_TOOL_REJECTING_PREFIXES);
}

/**
 * The request fields that keep a no-reasoning, structured-or-text call valid
 * on `model`. Spread into a Messages API request body.
 */
export function modelRequestShape(
  model: string,
  input: { temperature?: number; omitTemperature?: boolean; disableThinking?: boolean }
): {
  temperature?: number;
  thinking?: { type: "disabled" } | { type: "between_tools" };
  output_config?: { effort: "low" };
} {
  const shape: ReturnType<typeof modelRequestShape> = {};
  if (!input.omitTemperature && modelAcceptsSampling(model)) {
    shape.temperature = input.temperature ?? 0;
  }
  // Callers that never asked for thinking control still get the model's
  // no-reasoning form on the families that think by default: a model swap
  // must not silently add reasoning latency to a live phone turn.
  if (input.disableThinking || modelDefaultsToThinking(model)) {
    const off = thinkingOffShape(model);
    if (off.kind === "param") shape.thinking = off.thinking;
    if (off.kind === "low_effort") shape.output_config = { effort: "low" };
  }
  return shape;
}
