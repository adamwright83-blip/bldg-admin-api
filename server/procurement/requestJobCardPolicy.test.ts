import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildRequestJobCard } from "./requestJobCardPolicy";

const NOW = new Date("2026-06-21T12:00:00Z");
const falseOutcomes = {
  booked: false, providerAccepted: false, bookingVerified: false, dispatched: false,
  paymentAuthorized: false, paymentCaptured: false, completed: false, vendorContacted: false,
  residentNotified: false, llmCalled: false, stateMutated: false,
} as const;

function build(patch: Record<string, unknown> = {}) {
  return buildRequestJobCard({
    serviceIntent: "dog-grooming-request",
    rawRequest: "Can you get Theo groomed Friday?",
    residentContext: { bldgUserId: 42, residentName: "Adam", buildingSlug: "the-waverly", unit: "4A" },
    facts: { requestedDate: "2026-06-26", dog: { name: "Theo", size: "medium", temperament: "anxious" } },
    source: { sourceType: "resident_chat", conversationId: "conversation-1", sessionId: "session-1" },
    classificationConfidence: 0.9,
    now: NOW,
    ...patch,
  });
}

describe("request job-card policy", () => {
  it("turns a complete messy resident request into a clean administrative job card", () => {
    expect(build()).toMatchObject({
      status: "job_card_ready_for_admin_review", jobCardAllowed: true,
      category: "dog_grooming", serviceLabel: "Dog Grooming",
      rawRequest: "Can you get Theo groomed Friday?", displaySummary: "Can you get Theo groomed Friday?",
      residentContext: { bldgUserId: "42", buildingSlug: "the-waverly", unit: "4A" },
      requestFacts: { requestedDate: "2026-06-26", dog: { name: "Theo", size: "medium", temperament: "anxious" } },
      classificationConfidence: 0.9, administrativeOnly: true, ...falseOutcomes,
    });
  });

  it("preserves a reviewable card while asking exactly one missing question", () => {
    const result = build({ facts: { requestedDate: "2026-06-26", dog: { name: "Theo" } } });
    expect(result).toMatchObject({
      status: "job_card_needs_clarification", jobCardAllowed: true,
      reasonCodes: ["missing:dog_size_or_breed"],
      completeness: { nextQuestionKey: "dog_size_or_breed", nextQuestion: "What size or breed is your dog?",
        maySourceVendor: false, mayBook: false },
      ...falseOutcomes,
    });
  });

  it.each([
    ["missing raw request", { rawRequest: "" }, "raw_request_missing"],
    ["unknown intent", { serviceIntent: "dragon walking" }, "service_intent_unrecognized"],
    ["invalid confidence", { classificationConfidence: 2 }, "classification_confidence_invalid"],
    ["invalid timestamp", { now: new Date("invalid") }, "job_card_timestamp_invalid"],
  ])("fails closed for %s", (_name, patch, reason) => {
    const result = build(patch);
    expect(result.status).toBe("job_card_not_allowed");
    expect(result.jobCardAllowed).toBe(false);
    expect(result.reasonCodes).toContain(reason);
    expect(result).toMatchObject(falseOutcomes);
  });

  it("accepts all existing source-record types without creating an adapter or persistence", () => {
    for (const sourceType of ["resident_chat", "service_request", "coordinated_request", "resident_agent_plan", "manual"] as const) {
      expect(build({ source: { sourceType, sourceId: "123" } }).source).toMatchObject({ sourceType, sourceId: "123" });
    }
  });

  it("contains no IO, persistence, route, UI, worker, LLM, or execution behavior", () => {
    const source = readFileSync("server/procurement/requestJobCardPolicy.ts", "utf8");
    expect(source).not.toMatch(/\b(fetch|axios|execute|query|insert|update|delete|invokeLLM)\s*\(/i);
    expect(source).not.toMatch(/\b(Router|worker|connector|stripe|twilio|sendgrid|openai|anthropic)\b/i);
    expect(source).not.toMatch(/CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE/i);
  });
});
