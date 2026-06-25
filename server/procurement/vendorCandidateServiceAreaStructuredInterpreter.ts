// Slice 81b. Bounded structured Claude interpreter for the website
// evidence Slice 81a's deterministic verifier already safely fetched.
//
// This mirrors the 77a -> 77b pattern exactly: the 81a deterministic
// verifier (vendorCandidateServiceAreaVerifier.ts) remains the fallback
// when this is unavailable, fails, times out, or returns output that
// fails validation. Reuses the existing invokeLLM wrapper
// (server/_core/llm.ts) and ANTHROPIC_API_KEY env var -- no new SDK, no
// new provider wrapper, no new env var naming convention.
//
// This call is given ONLY already-fetched, already-capped website text
// and candidate/mission metadata that 81a's safe GET-only fetch
// produced -- it is never given network access, a browser, or any tool.
// It returns plain JSON through a forced single tool_use response,
// validated with zod before anything else touches it. It must never
// send outreach, submit a form, contact a vendor, book, dispatch,
// accept a provider, authorize/capture payment, or mutate any vendor
// truth field -- and nothing in this module is capable of any of that
// even if the model tried.

import { z } from "zod";
import { ENV } from "../_core/env";
import { invokeLLM } from "../_core/llm";
import type { ContactRoute, OutreachReadiness, ServiceAreaStatus, ServiceAreaVerification } from "./vendorCandidateServiceAreaVerifier";

export const ANTHROPIC_API_KEY_ENV_VAR = "ANTHROPIC_API_KEY";

const SERVICE_AREA_STATUSES = ["verified_serves_target", "likely_serves_target", "unverified", "likely_out_of_area", "out_of_area"] as const;
const CONTACT_ROUTES = ["email_available", "contact_form_available", "phone_available", "sms_or_call_required", "unknown"] as const;
const OUTREACH_READINESS_VALUES = ["email_ready", "manual_email_needed", "form_required", "sms_or_call_required", "not_outreach_ready"] as const;
const CONFIDENCE_VALUES = ["high", "medium", "low"] as const;

export type StructuredServiceAreaInterpretation = {
  serviceAreaStatus: ServiceAreaStatus;
  serviceAreaReasons: string[];
  targetZipSupported: boolean;
  targetBuildingSupported: boolean;
  targetNeighborhoodSupported: boolean;
  serviceAreaTextSummary: string;
  contactRoute: ContactRoute;
  outreachReadiness: OutreachReadiness;
  confidence: typeof CONFIDENCE_VALUES[number];
  requiresHumanReview: boolean;
};

export type StructuredInterpretInput = {
  missionText: string | null;
  targetZip: string | null;
  targetBuildingName: string | null;
  targetNeighborhood: string | null;
  candidateName: string;
  candidateAddress: string | null;
  candidateAddressZip: string | null;
  candidateWebsite: string | null;
  candidatePhone: string | null;
  deterministicResult: ServiceAreaVerification;
  websiteText: string;
};

export type StructuredInterpretResult =
  | { status: "skipped_no_text" }
  | { status: "needs_provider_config"; missingEnvVar: typeof ANTHROPIC_API_KEY_ENV_VAR }
  | { status: "provider_error"; reason: string }
  | { status: "invalid_output"; reason: string }
  | { status: "ok"; interpretation: StructuredServiceAreaInterpretation };

const MIN_MEANINGFUL_TEXT_LENGTH = 40;
// Defense in depth alongside 81a's own fetch cap: never forward more
// than this many characters of website text into the prompt.
const MAX_WEBSITE_TEXT_IN_PROMPT = 8_000;

const interpretationZodSchema = z.object({
  serviceAreaStatus: z.enum(SERVICE_AREA_STATUSES),
  serviceAreaReasons: z.array(z.string().min(1).max(300)).max(10),
  targetZipSupported: z.boolean(),
  targetBuildingSupported: z.boolean(),
  targetNeighborhoodSupported: z.boolean(),
  serviceAreaTextSummary: z.string().max(500),
  contactRoute: z.enum(CONTACT_ROUTES),
  outreachReadiness: z.enum(OUTREACH_READINESS_VALUES),
  confidence: z.enum(CONFIDENCE_VALUES),
  requiresHumanReview: z.boolean(),
}).strict();

const interpretationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "serviceAreaStatus", "serviceAreaReasons", "targetZipSupported", "targetBuildingSupported",
    "targetNeighborhoodSupported", "serviceAreaTextSummary", "contactRoute", "outreachReadiness",
    "confidence", "requiresHumanReview",
  ],
  properties: {
    serviceAreaStatus: { type: "string", enum: SERVICE_AREA_STATUSES as unknown as string[] },
    serviceAreaReasons: { type: "array", items: { type: "string" } },
    targetZipSupported: { type: "boolean" },
    targetBuildingSupported: { type: "boolean" },
    targetNeighborhoodSupported: { type: "boolean" },
    serviceAreaTextSummary: { type: "string" },
    contactRoute: { type: "string", enum: CONTACT_ROUTES as unknown as string[] },
    outreachReadiness: { type: "string", enum: OUTREACH_READINESS_VALUES as unknown as string[] },
    confidence: { type: "string", enum: CONFIDENCE_VALUES as unknown as string[] },
    requiresHumanReview: { type: "boolean" },
  },
};

const SYSTEM_PROMPT = [
  "You read website text that has already been safely fetched (read-only, no form submitted, no browser actions taken) for one vendor candidate, plus a deterministic verifier's own result, and decide whether the evidence supports the vendor serving one specific mission target ZIP/building/neighborhood.",
  "Return JSON only, through the structured schema. No prose, no explanation outside the schema fields.",
  "You may ONLY use the website text, candidate metadata, and deterministic result given to you. You have not visited any other page, you have no other knowledge of this vendor, and you must never invent: a service area not present in the given text, an email address not present in the given text, or a building the vendor is claimed to serve that is not named in the given text.",
  "Being located in or near a large metro area (e.g. \"Los Angeles\", \"LA\") is NOT by itself evidence the vendor serves any one specific ZIP or building inside that metro area -- do not classify as verified_serves_target on that basis alone.",
  "Mark serviceAreaStatus as verified_serves_target ONLY if the text explicitly names the target ZIP, the target building name, or the target neighborhood given to you.",
  "If the text lists specific service areas and the target ZIP/building/neighborhood is not among them, classify as likely_out_of_area or unverified (never verified) and explain why in serviceAreaReasons.",
  "If the text uses vague, broad, or ambiguous phrasing about service area (e.g. \"Greater LA area\", \"surrounding neighborhoods\", \"ask us about your area\", \"Westside and central LA by request\") such that you cannot tell whether the specific target is covered, classify as unverified or likely_serves_target (never verified_serves_target) and set requiresHumanReview to true.",
  "There is no fixed policy for whether one named neighborhood implies coverage of an adjacent target neighborhood/ZIP (e.g. whether a vendor that lists \"Hollywood\" should count as covering ZIP 90027) -- when this kind of adjacency judgment is the only basis for a verified classification, do not mark verified; mark likely_serves_target or unverified and set requiresHumanReview to true instead.",
  "contactRoute and outreachReadiness must reflect only what is actually present in the text: an email address only if one literally appears, a contact form only if one is described as present, a phone number only if one was given to you.",
].join("\n");

function buildUserMessage(input: StructuredInterpretInput): string {
  return JSON.stringify({
    missionText: input.missionText,
    targetZip: input.targetZip,
    targetBuildingName: input.targetBuildingName,
    targetNeighborhood: input.targetNeighborhood,
    candidateName: input.candidateName,
    candidateAddress: input.candidateAddress,
    candidateAddressZip: input.candidateAddressZip,
    candidateWebsite: input.candidateWebsite,
    candidatePhone: input.candidatePhone,
    deterministicVerifierResult: {
      serviceAreaStatus: input.deterministicResult.serviceAreaStatus,
      candidateAddressZip: input.deterministicResult.candidateAddressZip,
      distanceMilesToTarget: input.deterministicResult.distanceMilesToTarget,
      websiteServiceAreas: input.deterministicResult.websiteServiceAreas,
      emailAddressesFound: input.deterministicResult.emailAddressesFound,
      contactFormDetected: input.deterministicResult.contactFormDetected,
      phoneFound: input.deterministicResult.phoneFound,
    },
    websiteText: input.websiteText.slice(0, MAX_WEBSITE_TEXT_IN_PROMPT),
  });
}

/**
 * Never calls Claude for empty/near-empty website text -- there is
 * nothing meaningful to interpret, and the deterministic result is
 * already the right answer in that case.
 */
export async function interpretServiceAreaWithClaude(
  input: StructuredInterpretInput,
  options: { invoke?: typeof invokeLLM; tenantId?: string } = {},
): Promise<StructuredInterpretResult> {
  if (!input.websiteText || input.websiteText.trim().length < MIN_MEANINGFUL_TEXT_LENGTH) {
    return { status: "skipped_no_text" };
  }

  const invoke = options.invoke ?? invokeLLM;
  let result: Awaited<ReturnType<typeof invokeLLM>>;
  try {
    result = await invoke({
      tenantId: options.tenantId ?? "default",
      model: ENV.anthropicModelServiceAreaVerifier || ENV.anthropicModel,
      temperature: 0,
      maxTokens: 1024,
      outputSchema: { name: "service_area_interpretation", schema: interpretationJsonSchema, strict: true },
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

  const validated = interpretationZodSchema.safeParse(raw);
  if (!validated.success) {
    return { status: "invalid_output", reason: "schema_validation_failed" };
  }

  return { status: "ok", interpretation: validated.data };
}
