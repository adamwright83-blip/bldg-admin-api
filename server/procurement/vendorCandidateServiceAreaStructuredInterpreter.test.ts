import { describe, expect, it, vi } from "vitest";
import { interpretServiceAreaWithClaude } from "./vendorCandidateServiceAreaStructuredInterpreter";
import { verifyCandidateServiceArea } from "./vendorCandidateServiceAreaVerifier";

function makeInvokeResult(content: unknown) {
  return {
    id: "msg_1", created: Date.now(), model: "claude-test",
    choices: [{ index: 0, message: { role: "assistant" as const, content: JSON.stringify(content) }, finish_reason: "tool_use" }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  };
}

const DETERMINISTIC_BASE = {
  serviceAreaStatus: "unverified" as const, serviceAreaReasons: [], targetZipMatched: false, targetBuildingMatched: false,
  candidateAddressZip: null, distanceMilesToTarget: null, websiteChecked: true, websiteServiceAreas: [],
  websiteMentionsTargetZip: false, websiteMentionsTargetBuilding: false, contactRoute: "unknown" as const,
  emailAddressesFound: [], contactFormDetected: false, phoneFound: false, outreachReadiness: "not_outreach_ready" as const,
  verificationSource: "google_places_and_website" as const, verificationConfidence: "low" as const,
};

function baseInput(overrides?: Partial<Parameters<typeof interpretServiceAreaWithClaude>[0]>) {
  return {
    missionText: "Find me 10 mobile dog groomers near 90027 with 4.7+ ratings.",
    targetZip: "90027",
    targetBuildingName: "OPUS LA",
    targetNeighborhood: null,
    candidateName: "Test Groomer",
    candidateAddress: "1 Main St, Los Angeles, CA 90027, USA",
    candidateAddressZip: "90027",
    candidateWebsite: "https://example.com",
    candidatePhone: "555-1234",
    deterministicResult: DETERMINISTIC_BASE,
    websiteText: "We proudly serve 90027 and the surrounding area. Email us at hello@example.com.",
    ...overrides,
  };
}

const VALID_VERIFIED_INTERPRETATION = {
  serviceAreaStatus: "verified_serves_target", serviceAreaReasons: ["Website explicitly mentions 90027"],
  targetZipSupported: true, targetBuildingSupported: false, targetNeighborhoodSupported: false,
  serviceAreaTextSummary: "Site explicitly states it serves 90027.",
  contactRoute: "email_available", outreachReadiness: "email_ready", confidence: "high", requiresHumanReview: false,
};

describe("interpretServiceAreaWithClaude -- success", () => {
  it("returns a valid structured interpretation when Claude returns valid JSON", async () => {
    const invoke = vi.fn().mockResolvedValue(makeInvokeResult(VALID_VERIFIED_INTERPRETATION));
    const result = await interpretServiceAreaWithClaude(baseInput(), { invoke });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.interpretation.serviceAreaStatus).toBe("verified_serves_target");
    expect(result.interpretation.contactRoute).toBe("email_available");
  });

  it("calls invoke exactly once per candidate", async () => {
    const invoke = vi.fn().mockResolvedValue(makeInvokeResult(VALID_VERIFIED_INTERPRETATION));
    await interpretServiceAreaWithClaude(baseInput(), { invoke });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("only forwards the already-fetched website text and metadata it was given -- never re-fetches or browses", async () => {
    const invoke = vi.fn().mockResolvedValue(makeInvokeResult(VALID_VERIFIED_INTERPRETATION));
    await interpretServiceAreaWithClaude(baseInput(), { invoke });
    const callArgs = invoke.mock.calls[0][0];
    const userMessage = callArgs.messages.find((m: { role: string }) => m.role === "user");
    expect(userMessage.content).toContain("hello@example.com");
    expect(callArgs.tools).toBeUndefined();
  });
});

describe("interpretServiceAreaWithClaude -- fallback behavior", () => {
  it("falls back when the model returns invalid JSON", async () => {
    const invoke = vi.fn().mockResolvedValue({
      id: "msg_1", created: Date.now(), model: "claude-test",
      choices: [{ index: 0, message: { role: "assistant" as const, content: "not json" }, finish_reason: "tool_use" }],
    });
    const result = await interpretServiceAreaWithClaude(baseInput(), { invoke });
    expect(result.status).toBe("invalid_output");
  });

  it("falls back when the output fails schema validation (invalid enum)", async () => {
    const invoke = vi.fn().mockResolvedValue(makeInvokeResult({ ...VALID_VERIFIED_INTERPRETATION, serviceAreaStatus: "definitely_serves_target" }));
    const result = await interpretServiceAreaWithClaude(baseInput(), { invoke });
    expect(result.status).toBe("invalid_output");
  });

  it("falls back when extra/unknown fields are present (strict schema)", async () => {
    const invoke = vi.fn().mockResolvedValue(makeInvokeResult({ ...VALID_VERIFIED_INTERPRETATION, invented: true }));
    const result = await interpretServiceAreaWithClaude(baseInput(), { invoke });
    expect(result.status).toBe("invalid_output");
  });

  it("falls back with needs_provider_config when ANTHROPIC_API_KEY is not configured", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("ANTHROPIC_API_KEY is not configured"));
    const result = await interpretServiceAreaWithClaude(baseInput(), { invoke });
    expect(result.status).toBe("needs_provider_config");
  });

  it("falls back with provider_error on a generic invoke failure, never throwing", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("upstream 503"));
    const result = await interpretServiceAreaWithClaude(baseInput(), { invoke });
    expect(result.status).toBe("provider_error");
  });

  it("skips calling Claude entirely when there is no meaningful website text", async () => {
    const invoke = vi.fn();
    const result = await interpretServiceAreaWithClaude(baseInput({ websiteText: "" }), { invoke });
    expect(result.status).toBe("skipped_no_text");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("skips calling Claude when the website fetch failed (no text at all)", async () => {
    const invoke = vi.fn();
    const result = await interpretServiceAreaWithClaude(baseInput({ websiteText: "ok" }), { invoke });
    expect(result.status).toBe("skipped_no_text");
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("interpretServiceAreaWithClaude -- never invents evidence (source isolation)", () => {
  it("never imports or calls any send/automation API", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.resolve(__dirname, "vendorCandidateServiceAreaStructuredInterpreter.ts"), "utf8");
    expect(source).not.toMatch(/sendSms|sendYelpMessage|placeCall|elevenlabs|puppeteer|playwright|\.submit\(\)/i);
  });

  it("the system prompt instructs the model not to invent service areas, emails, or served buildings", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.resolve(__dirname, "vendorCandidateServiceAreaStructuredInterpreter.ts"), "utf8");
    expect(source).toMatch(/never invent/i);
  });
});

describe("interpretServiceAreaWithClaude -- Sunset-like fixture", () => {
  const sunsetWebsiteText = "Service Areas: San Fernando Valley, Woodland Hills, West Hills, Tarzana, Encino, North Hollywood, Palisades, Malibu, Topanga Canyon, Santa Monica, Brentwood, Hollywood. Contact us through the form below or call (818) 555-0199.";

  it("is not verified_serves_target and not email_ready", async () => {
    const interpretation = {
      serviceAreaStatus: "likely_out_of_area", serviceAreaReasons: ["Explicit service-area list excludes 90027 and OPUS LA"],
      targetZipSupported: false, targetBuildingSupported: false, targetNeighborhoodSupported: false,
      serviceAreaTextSummary: "Site lists San Fernando Valley area neighborhoods; does not mention 90027 or OPUS LA.",
      contactRoute: "contact_form_available", outreachReadiness: "form_required", confidence: "medium", requiresHumanReview: true,
    };
    const invoke = vi.fn().mockResolvedValue(makeInvokeResult(interpretation));
    const result = await interpretServiceAreaWithClaude(baseInput({
      candidateName: "Sunset Mobile Grooming",
      candidateAddress: "456 Valley Way, Reseda, CA 91306, USA",
      candidateAddressZip: "91306",
      websiteText: sunsetWebsiteText,
      deterministicResult: { ...DETERMINISTIC_BASE, serviceAreaStatus: "likely_out_of_area", candidateAddressZip: "91306", contactFormDetected: true, phoneFound: true, websiteServiceAreas: ["San Fernando Valley", "Hollywood"] },
    }), { invoke });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.interpretation.serviceAreaStatus).not.toBe("verified_serves_target");
    expect(["unverified", "likely_out_of_area"]).toContain(result.interpretation.serviceAreaStatus);
    expect(result.interpretation.requiresHumanReview).toBe(true);
    expect(["contact_form_available", "phone_available"]).toContain(result.interpretation.contactRoute);
    expect(["form_required", "sms_or_call_required"]).toContain(result.interpretation.outreachReadiness);
    expect(result.interpretation.outreachReadiness).not.toBe("email_ready");
  });
});

describe("interpretServiceAreaWithClaude -- ambiguous phrasing fixture", () => {
  it("'Greater LA area' phrasing produces likely/unverified + human review, never a false verified", async () => {
    const interpretation = {
      serviceAreaStatus: "unverified", serviceAreaReasons: ["Text only mentions the Greater LA area broadly; does not name 90027 or OPUS LA specifically"],
      targetZipSupported: false, targetBuildingSupported: false, targetNeighborhoodSupported: false,
      serviceAreaTextSummary: "Vague metro-wide claim, no specific target confirmation.",
      contactRoute: "phone_available", outreachReadiness: "sms_or_call_required", confidence: "low", requiresHumanReview: true,
    };
    const invoke = vi.fn().mockResolvedValue(makeInvokeResult(interpretation));
    const result = await interpretServiceAreaWithClaude(baseInput({
      websiteText: "We proudly serve the Greater LA area. Ask us about your neighborhood -- we come to your home or building. Call (555) 123-4567.",
    }), { invoke });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.interpretation.serviceAreaStatus).not.toBe("verified_serves_target");
    expect(result.interpretation.requiresHumanReview).toBe(true);
  });
});

describe("interpretServiceAreaWithClaude -- explicit target match fixtures", () => {
  it("returns verified when the text explicitly names the target ZIP", async () => {
    const invoke = vi.fn().mockResolvedValue(makeInvokeResult({ ...VALID_VERIFIED_INTERPRETATION, targetZipSupported: true }));
    const result = await interpretServiceAreaWithClaude(baseInput({ websiteText: "We serve ZIP 90027 and nearby areas. Email hello@example.com." }), { invoke });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.interpretation.serviceAreaStatus).toBe("verified_serves_target");
    expect(result.interpretation.targetZipSupported).toBe(true);
  });

  it("returns verified when the text explicitly names the target building", async () => {
    const invoke = vi.fn().mockResolvedValue(makeInvokeResult({
      ...VALID_VERIFIED_INTERPRETATION, targetZipSupported: false, targetBuildingSupported: true,
    }));
    const result = await interpretServiceAreaWithClaude(baseInput({ websiteText: "We are the preferred mobile groomer for OPUS LA residents. Email hello@example.com." }), { invoke });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.interpretation.serviceAreaStatus).toBe("verified_serves_target");
    expect(result.interpretation.targetBuildingSupported).toBe(true);
  });
});

describe("interpretServiceAreaWithClaude -- contact route fixtures", () => {
  it("a contact form with no email returns form_required, not email_ready", async () => {
    const invoke = vi.fn().mockResolvedValue(makeInvokeResult({
      ...VALID_VERIFIED_INTERPRETATION, contactRoute: "contact_form_available", outreachReadiness: "form_required",
    }));
    const result = await interpretServiceAreaWithClaude(baseInput({ websiteText: "We serve 90027. Fill out our contact form to reach us -- no email address listed here." }), { invoke });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.interpretation.outreachReadiness).toBe("form_required");
    expect(result.interpretation.outreachReadiness).not.toBe("email_ready");
  });

  it("an email present in the text returns email_ready", async () => {
    const invoke = vi.fn().mockResolvedValue(makeInvokeResult(VALID_VERIFIED_INTERPRETATION));
    const result = await interpretServiceAreaWithClaude(baseInput(), { invoke });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.interpretation.outreachReadiness).toBe("email_ready");
  });
});

describe("interpretServiceAreaWithClaude -- integration with the real deterministic verifier shape", () => {
  it("accepts the real ServiceAreaVerification shape produced by verifyCandidateServiceArea", async () => {
    const deterministicResult = await verifyCandidateServiceArea({
      candidate: { address: null, website: null, phone: null, coordinates: null },
      targetZip: "90027",
      targetBuildingName: "OPUS LA",
    });
    const invoke = vi.fn().mockResolvedValue(makeInvokeResult(VALID_VERIFIED_INTERPRETATION));
    const result = await interpretServiceAreaWithClaude(baseInput({ deterministicResult, websiteText: "We serve 90027. Email hello@example.com." }), { invoke });
    expect(result.status).toBe("ok");
  });
});
