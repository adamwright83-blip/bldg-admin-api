// Slice 77b. Bounded structured Claude parser for Mission Composer text.
//
// This is the primary mission-text query-planning path; the deterministic
// keyword planner from Slice 77a (vendorMissionQueryPlanner.ts) remains the
// fallback when this is unavailable, fails, times out, or returns output
// that fails validation. Reuses the existing invokeLLM wrapper
// (server/_core/llm.ts) and ANTHROPIC_API_KEY/ANTHROPIC_MODEL env vars
// already used by vendorOnboardingAgent.ts -- no new SDK, no new provider
// wrapper, no new env var naming convention introduced.
//
// This call produces ONLY search-query-planning JSON for a read-only
// Google Places lookup. It is never given, and structurally cannot reach,
// any tool, mutation, or side effect: it returns plain JSON through a
// forced single tool_use response, validated with zod before anything
// else touches it. It must never send outreach, contact a vendor, book,
// dispatch, accept a provider, authorize/capture payment, or mutate any
// vendor truth field -- and nothing in this module is capable of any of
// that even if the model tried.

import { z } from "zod";
import { ENV } from "../_core/env";
import { invokeLLM } from "../_core/llm";
import { MAX_QUERY_VARIANTS, SERVICE_MODES, type MissionQueryPlan } from "./vendorMissionQueryPlanner";

export const ANTHROPIC_API_KEY_ENV_VAR = "ANTHROPIC_API_KEY";

export type StructuredParseInput = {
  missionText: string | null;
  category: string;
  geographyLabel: string;
  ratingThreshold?: number | null;
  targetQuantity: number;
};

export type StructuredParseResult =
  | { status: "needs_provider_config"; missingEnvVar: typeof ANTHROPIC_API_KEY_ENV_VAR }
  | { status: "provider_error"; reason: string }
  | { status: "invalid_output"; reason: string }
  | { status: "ok"; plan: MissionQueryPlan };

const missionQueryPlanZodSchema = z.object({
  primaryIntent: z.string().min(1).max(200),
  serviceCategory: z.string().min(1).max(100),
  locationText: z.string().min(1).max(255),
  searchQueries: z.array(z.string().min(1).max(200)).min(1).max(MAX_QUERY_VARIANTS),
  requiredTerms: z.array(z.string().min(1).max(100)).max(20),
  preferredTerms: z.array(z.string().min(1).max(100)).max(20),
  excludedTerms: z.array(z.string().min(1).max(100)).max(20),
  serviceMode: z.enum(SERVICE_MODES),
  confidence: z.enum(["low", "medium", "high"]),
  notes: z.array(z.string().min(1).max(500)).max(10),
}).strict();

const planJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "primaryIntent", "serviceCategory", "locationText", "searchQueries",
    "requiredTerms", "preferredTerms", "excludedTerms", "serviceMode", "confidence", "notes",
  ],
  properties: {
    primaryIntent: { type: "string" },
    serviceCategory: { type: "string" },
    locationText: { type: "string" },
    searchQueries: { type: "array", items: { type: "string" }, maxItems: MAX_QUERY_VARIANTS },
    requiredTerms: { type: "array", items: { type: "string" } },
    preferredTerms: { type: "array", items: { type: "string" } },
    excludedTerms: { type: "array", items: { type: "string" } },
    serviceMode: { type: "string", enum: SERVICE_MODES as unknown as string[] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    notes: { type: "array", items: { type: "string" } },
  },
};

const SYSTEM_PROMPT = [
  "You turn an apartment-operator's vendor-sourcing mission text into a Google Places search-query plan.",
  "Return JSON only, through the structured schema. No prose, no explanation outside the schema fields.",
  "You never make claims about any actual vendor, business, rating, or review count -- you have not seen any vendor data.",
  "You never invent or imply that a candidate has already been found; this is query planning, not vendor discovery.",
  "Distinguish mobile/at-home/building-service requests (vendor comes to the resident or building) from storefront/drive-to requests (resident goes to the vendor) when the mission text implies either, even if it does not use the literal words \"mobile\" or \"storefront\".",
  "Examples that imply mobile/building service even without the word \"mobile\": \"groomers who will come to the building\", \"in-unit dog grooming\", \"won't make residents leave the property\".",
  "Examples that imply storefront/drive-to: \"residents can drive to\", \"a salon near\", \"an appointment they go to\".",
  `Generate at most ${MAX_QUERY_VARIANTS} distinct Google Places search query strings appropriate to the mission, preserving the operator's actual intent.`,
  "If the mission text gives no service-mode signal at all, set serviceMode to \"unknown\" and generate generic category+location queries.",
].join("\n");

function buildUserMessage(input: StructuredParseInput): string {
  return JSON.stringify({
    missionText: input.missionText,
    category: input.category,
    geographyLabel: input.geographyLabel,
    ratingThreshold: input.ratingThreshold ?? null,
    targetQuantity: input.targetQuantity,
  });
}

export async function parseMissionWithClaude(
  input: StructuredParseInput,
  options: { invoke?: typeof invokeLLM; tenantId?: string } = {},
): Promise<StructuredParseResult> {
  if (!input.missionText || !input.missionText.trim()) {
    return { status: "invalid_output", reason: "no_mission_text" };
  }

  const invoke = options.invoke ?? invokeLLM;
  let result: Awaited<ReturnType<typeof invokeLLM>>;
  try {
    result = await invoke({
      tenantId: options.tenantId ?? "default",
      model: ENV.anthropicModelMissionPlanner || ENV.anthropicModel,
      temperature: 0,
      maxTokens: 1024,
      outputSchema: { name: "mission_query_plan", schema: planJsonSchema, strict: true },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(input) },
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ANTHROPIC_API_KEY is not configured/i.test(message)) {
      return { status: "needs_provider_config", missingEnvVar: ANTHROPIC_API_KEY_ENV_VAR };
    }
    return { status: "provider_error", reason: message };
  }

  let raw: unknown;
  try {
    const content = result.choices[0]?.message.content;
    raw = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
  } catch {
    return { status: "invalid_output", reason: "invalid_json" };
  }

  const validated = missionQueryPlanZodSchema.safeParse(raw);
  if (!validated.success) {
    return { status: "invalid_output", reason: "schema_validation_failed" };
  }

  // Defense in depth: never trust the model's own array lengths even
  // though the JSON schema and zod schema already cap them.
  const plan: MissionQueryPlan = {
    ...validated.data,
    searchQueries: validated.data.searchQueries.slice(0, MAX_QUERY_VARIANTS),
  };

  return { status: "ok", plan };
}
