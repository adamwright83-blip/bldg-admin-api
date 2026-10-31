import { z } from "zod";
import { invokeLLM } from "../../_core/llm";
import { heuristicInterpret, heuristicInvestigator } from "./heuristic";
import { EMPTY_INTERPRETATION, INVESTIGATOR_SYSTEM, interpretationSchema, type InterpretInput, type Interpretation, type InvestigatorModel } from "./interpretation";
import { materialLine } from "./material";

/**
 * Which model interprets what the investigator reads. Configurable, never hard-wired:
 *
 *   JOYSTICK_INVESTIGATOR_MODEL = claude (default) | gemini | heuristic
 *   JOYSTICK_INVESTIGATOR_CLAUDE_MODEL   (default: ANTHROPIC_MODEL, through server/_core/llm.ts)
 *   JOYSTICK_INVESTIGATOR_GEMINI_MODEL   (default gemini-2.5-flash; needs GEMINI_API_KEY)
 *
 * Whatever is chosen, the deterministic interpreter runs beside it every round and both are verified the same way
 * (apply.ts), so a model can add findings but can't remove the floor, and a model failure degrades to the floor
 * rather than to nothing. Consumer Gemini's built-in Gmail is not an API available to third parties: Gemini here
 * reads only what JOYSTICK's own tools fetched.
 */
export const INVESTIGATOR_MODEL_FLAG = "JOYSTICK_INVESTIGATOR_MODEL";

export type ModelUsage = { calls: number; failures: number; inputTokens: number; outputTokens: number; latencyMs: number };

export function investigatorPrompt(input: InterpretInput): string {
  return [
    `<context today="${input.now.toISOString().slice(0, 10)}" owner="${(input.ownerName ?? "").replace(/"/g, "'")}" owner_email="${input.ownerEmail}">`,
    `<known_entities>${JSON.stringify(input.known.entities)}</known_entities>`,
    `<known_people>${JSON.stringify(input.known.people)}</known_people>`,
    `<open_research_questions>${JSON.stringify(input.agenda)}</open_research_questions>`,
    `<remaining_budget>${JSON.stringify(input.remaining)}</remaining_budget>`,
    "</context>",
    "<material>",
    ...input.material.map(item => materialLine(item, input.ownerEmail)),
    "</material>",
  ].join("\n");
}

/** Claude through the existing LLM layer (structured output), attributed to the journey's AI spend. */
export function claudeInvestigator(journeyId: string, usage: ModelUsage, env: NodeJS.ProcessEnv = process.env): InvestigatorModel {
  const model = env.JOYSTICK_INVESTIGATOR_CLAUDE_MODEL?.trim() || undefined;
  return {
    name: `claude${model ? `:${model}` : ""}`,
    async interpret(input) {
      const started = Date.now();
      usage.calls += 1;
      try {
        const result = await invokeLLM({
          tenantId: `first_ten:${journeyId}`,
          feature: "onboarding_investigator",
          model,
          maxTokens: 6000,
          timeoutMs: 60_000,
          messages: [
            { role: "system", content: INVESTIGATOR_SYSTEM },
            { role: "user", content: investigatorPrompt(input) },
          ],
          responseFormat: {
            type: "json_schema",
            json_schema: { name: "onboarding_investigation", strict: true, schema: z.toJSONSchema(interpretationSchema) as Record<string, unknown> },
          },
        });
        const content = result.choices[0]?.message.content;
        if (typeof content !== "string") throw new Error("The investigator returned nothing structured");
        const usageInfo = (result as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
        usage.inputTokens += usageInfo?.prompt_tokens ?? 0;
        usage.outputTokens += usageInfo?.completion_tokens ?? 0;
        return interpretationSchema.parse(JSON.parse(content));
      } catch (error) {
        usage.failures += 1;
        throw error;
      } finally {
        usage.latencyMs += Date.now() - started;
      }
    },
  };
}

/**
 * Gemini through Google's Generative Language API with a JSON response schema. The key travels in a header, never
 * in the URL. Only built when GEMINI_API_KEY is configured; JOYSTICK never creates one.
 */
export function geminiInvestigator(usage: ModelUsage, deps: { fetch?: typeof fetch; env?: NodeJS.ProcessEnv } = {}): InvestigatorModel | null {
  const env = deps.env ?? process.env;
  const key = env.GEMINI_API_KEY?.trim();
  if (!key) return null;
  const model = env.JOYSTICK_INVESTIGATOR_GEMINI_MODEL?.trim() || "gemini-2.5-flash";
  const fetcher = deps.fetch ?? fetch;
  return {
    name: `gemini:${model}`,
    async interpret(input) {
      const started = Date.now();
      usage.calls += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      try {
        const schema = z.toJSONSchema(interpretationSchema) as Record<string, unknown>;
        delete schema.$schema;
        const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          signal: controller.signal,
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: INVESTIGATOR_SYSTEM }] },
            contents: [{ role: "user", parts: [{ text: investigatorPrompt(input) }] }],
            generationConfig: { temperature: 0, responseMimeType: "application/json", responseJsonSchema: schema, maxOutputTokens: 6000 },
          }),
        });
        if (!response.ok) throw new Error(`Gemini answered ${response.status}`);
        const body = (await response.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        };
        usage.inputTokens += body.usageMetadata?.promptTokenCount ?? 0;
        usage.outputTokens += body.usageMetadata?.candidatesTokenCount ?? 0;
        const text = body.candidates?.[0]?.content?.parts?.map(part => part.text ?? "").join("") ?? "";
        if (!text) throw new Error("Gemini returned nothing");
        return interpretationSchema.parse(JSON.parse(text));
      } catch (error) {
        usage.failures += 1;
        throw error instanceof Error && error.name === "AbortError" ? new Error("Gemini timed out") : error;
      } finally {
        clearTimeout(timer);
        usage.latencyMs += Date.now() - started;
      }
    },
  };
}

/** Two interpretations as one: everything each found (apply.ts verifies all of it); the model's tool calls lead. */
export function mergeInterpretations(a: Interpretation, b: Interpretation): Interpretation {
  return {
    entities: [...a.entities, ...b.entities],
    people: [...a.people, ...b.people],
    events: [...a.events, ...b.events],
    statuses: [...a.statuses, ...b.statuses],
    relationships: [...a.relationships, ...b.relationships],
    questions: [...a.questions, ...b.questions],
    toolCalls: [...a.toolCalls, ...b.toolCalls],
    done: a.done && b.done,
  };
}

/**
 * The configured model with the deterministic floor beside it. A model call that fails (timeout, refusal, invalid
 * output) is counted and the round continues on the floor alone.
 */
export function withFloor(model: InvestigatorModel | null, usage: ModelUsage, notes: string[]): InvestigatorModel {
  if (!model) return heuristicInvestigator();
  return {
    name: `${model.name}+heuristic`,
    async interpret(input) {
      const floor = heuristicInterpret(input);
      try {
        return mergeInterpretations(await model.interpret(input), floor);
      } catch (error) {
        const reason = error instanceof Error ? error.message.slice(0, 80) : "unknown";
        if (!notes.includes(`model failed: ${reason}`)) notes.push(`model failed: ${reason}`);
        void usage;
        return { ...floor, done: false };
      }
    },
  };
}

export function investigatorFor(
  journeyId: string,
  usage: ModelUsage,
  notes: string[],
  deps: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch } = {}
): { model: InvestigatorModel; configured: string; missing: string | null } {
  const env = deps.env ?? process.env;
  const configured = env[INVESTIGATOR_MODEL_FLAG]?.trim().toLowerCase() || "claude";
  if (configured === "heuristic") return { model: heuristicInvestigator(), configured, missing: null };
  if (configured === "gemini") {
    const gemini = geminiInvestigator(usage, deps);
    if (!gemini) {
      notes.push("Gemini was chosen but GEMINI_API_KEY isn't configured; the deterministic investigator ran alone.");
      return { model: heuristicInvestigator(), configured, missing: "GEMINI_API_KEY" };
    }
    return { model: withFloor(gemini, usage, notes), configured, missing: null };
  }
  if (!env.ANTHROPIC_API_KEY?.trim()) {
    notes.push("No model key is configured; the deterministic investigator ran alone.");
    return { model: heuristicInvestigator(), configured, missing: "ANTHROPIC_API_KEY" };
  }
  return { model: withFloor(claudeInvestigator(journeyId, usage, env), usage, notes), configured, missing: null };
}

export { EMPTY_INTERPRETATION };
