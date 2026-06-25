import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseMissionWithClaude } from "./vendorMissionStructuredParser";

function makeInvokeResult(content: unknown) {
  return {
    id: "msg_1", created: Date.now(), model: "claude-test",
    choices: [{ index: 0, message: { role: "assistant" as const, content: JSON.stringify(content) }, finish_reason: "tool_use" }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  };
}

const VALID_PLAN = {
  primaryIntent: "mobile_required:dog_grooming",
  serviceCategory: "dog_grooming",
  locationText: "90027",
  searchQueries: ["mobile dog groomers near 90027", "dog grooming that comes to you near 90027"],
  requiredTerms: ["mobile"],
  preferredTerms: [],
  excludedTerms: [],
  serviceMode: "mobile_required" as const,
  confidence: "high" as const,
  notes: ["Mission text describes building/mobile service."],
};

const BASE_INPUT = {
  missionText: "Find me 10 mobile dog groomers near 90027 with 4.7+ ratings who can service luxury high-rise residents at their buildings.",
  category: "dog_grooming",
  geographyLabel: "90027 (5 mi radius)",
  ratingThreshold: 4.7,
  targetQuantity: 10,
};

describe("parseMissionWithClaude -- success", () => {
  it("returns a valid MissionQueryPlan when Claude returns valid structured JSON", async () => {
    const invoke = vi.fn().mockResolvedValue(makeInvokeResult(VALID_PLAN));
    const result = await parseMissionWithClaude(BASE_INPUT, { invoke });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.plan.serviceMode).toBe("mobile_required");
    expect(result.plan.searchQueries.length).toBeGreaterThan(0);
  });

  it("calls invoke exactly once per parse request -- not repeatedly while typing", async () => {
    const invoke = vi.fn().mockResolvedValue(makeInvokeResult(VALID_PLAN));
    await parseMissionWithClaude(BASE_INPUT, { invoke });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("passes the mission text, category, and geography to the model", async () => {
    const invoke = vi.fn().mockResolvedValue(makeInvokeResult(VALID_PLAN));
    await parseMissionWithClaude(BASE_INPUT, { invoke });
    const callArgs = invoke.mock.calls[0][0];
    const userMessage = callArgs.messages.find((m: { role: string }) => m.role === "user");
    expect(userMessage.content).toContain(BASE_INPUT.missionText);
    expect(userMessage.content).toContain("dog_grooming");
  });
});

describe("parseMissionWithClaude -- fallback paths", () => {
  it("returns needs_provider_config when invokeLLM reports the API key is not configured", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("ANTHROPIC_API_KEY is not configured"));
    const result = await parseMissionWithClaude(BASE_INPUT, { invoke });
    expect(result).toEqual({ status: "needs_provider_config", missingEnvVar: "ANTHROPIC_API_KEY" });
  });

  it("never leaks the API key in a provider_error result", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("Anthropic authentication failed (401)."));
    const result = await parseMissionWithClaude(BASE_INPUT, { invoke });
    expect(result.status).toBe("provider_error");
    expect(JSON.stringify(result)).not.toMatch(/sk-ant-|ANTHROPIC_API_KEY=/);
  });

  it("returns provider_error on a network/timeout-style failure rather than throwing", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("Anthropic is overloaded (529). Retry later."));
    const result = await parseMissionWithClaude(BASE_INPUT, { invoke });
    expect(result).toEqual({ status: "provider_error", reason: "Anthropic is overloaded (529). Retry later." });
  });

  it("returns invalid_output on malformed JSON content rather than throwing", async () => {
    const invoke = vi.fn().mockResolvedValue({
      id: "msg_1", created: Date.now(), model: "claude-test",
      choices: [{ index: 0, message: { role: "assistant" as const, content: "not valid json {" }, finish_reason: "tool_use" }],
    });
    const result = await parseMissionWithClaude(BASE_INPUT, { invoke });
    expect(result).toEqual({ status: "invalid_output", reason: "invalid_json" });
  });

  it("returns invalid_output when the model emits a serviceMode outside the controlled enum", async () => {
    const invoke = vi.fn().mockResolvedValue(makeInvokeResult({ ...VALID_PLAN, serviceMode: "anything_the_model_makes_up" }));
    const result = await parseMissionWithClaude(BASE_INPUT, { invoke });
    expect(result).toEqual({ status: "invalid_output", reason: "schema_validation_failed" });
  });

  it("returns invalid_output when a required field is missing from the model's output", async () => {
    const { searchQueries, ...withoutSearchQueries } = VALID_PLAN;
    const invoke = vi.fn().mockResolvedValue(makeInvokeResult(withoutSearchQueries));
    const result = await parseMissionWithClaude(BASE_INPUT, { invoke });
    expect(result).toEqual({ status: "invalid_output", reason: "schema_validation_failed" });
  });

  it("returns invalid_output when no mission text was provided -- nothing to parse", async () => {
    const invoke = vi.fn();
    const result = await parseMissionWithClaude({ ...BASE_INPUT, missionText: null }, { invoke });
    expect(result).toEqual({ status: "invalid_output", reason: "no_mission_text" });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("parseMissionWithClaude -- bounds and safety", () => {
  it("caps search query variants even if the model returns more than the max", async () => {
    const tooMany = Array.from({ length: 20 }, (_, i) => `query variant ${i}`);
    const invoke = vi.fn().mockResolvedValue(makeInvokeResult({ ...VALID_PLAN, searchQueries: tooMany }));
    const result = await parseMissionWithClaude(BASE_INPUT, { invoke });
    // The zod schema itself rejects more than MAX_QUERY_VARIANTS -- this
    // should fail validation rather than silently truncate model output,
    // since exceeding the cap means the model didn't follow instructions.
    expect(result.status).toBe("invalid_output");
  });

  it("never produces a candidate, vendor name, rating, or review count -- this module only plans queries", async () => {
    const invoke = vi.fn().mockResolvedValue(makeInvokeResult(VALID_PLAN));
    const result = await parseMissionWithClaude(BASE_INPUT, { invoke });
    expect(JSON.stringify(result)).not.toMatch(/businessName|placeId|rating|reviewCount/i);
  });
});

describe("parseMissionWithClaude -- isolation", () => {
  it("never imports or calls an outreach/send adapter, and never touches truth fields", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "vendorMissionStructuredParser.ts"), "utf8");
    expect(source).not.toMatch(/agentmail|sendVendorEmail|twilio|sendSms|elevenlabs|sendgrid/i);
    expect(source).not.toMatch(/provider_accepted|booking_confirmed|payment_authorized|\bdispatched\b/);
  });

  it("never logs/prints the API key", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "vendorMissionStructuredParser.ts"), "utf8");
    expect(source).not.toMatch(/console\.(log|error|warn|info)\(/);
  });

  it("the system prompt instructs the model never to claim a vendor was found", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "vendorMissionStructuredParser.ts"), "utf8");
    expect(source).toMatch(/never make claims about any actual vendor/i);
  });
});
