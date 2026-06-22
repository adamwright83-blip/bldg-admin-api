import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateRequestCompleteness } from "./requestCompletenessPolicy";

describe("request completeness policy", () => {
  it("asks only the highest-priority missing dog-grooming question", () => {
    expect(evaluateRequestCompleteness({ category: "dog_grooming", facts: {} })).toMatchObject({
      status: "needs_clarification", missingRequiredFacts: ["location", "requested_date", "dog_size_or_breed"],
      nextQuestionKey: "location", nextQuestion: "Which building or address is this for?",
      mayCreateJobCard: false, maySourceVendor: false, mayBook: false,
    });
  });

  it("accepts a request-scoped dog breed or size and does not require a durable pet profile", () => {
    const common = { buildingSlug: "the-waverly", requestedDate: "2026-06-26" };
    expect(evaluateRequestCompleteness({ category: "dog_grooming", facts: {
      ...common, dog: { size: "medium", temperament: "anxious" },
    } }).status).toBe("complete_for_job_card");
    expect(evaluateRequestCompleteness({ category: "dog_grooming", facts: {
      ...common, dog: { breed: "spaniel mix" },
    } }).status).toBe("complete_for_job_card");
  });

  it("does not interrogate laundry when established defaults can supply timing", () => {
    expect(evaluateRequestCompleteness({ category: "laundry", facts: { buildingSlug: "the-waverly" } }))
      .toMatchObject({ status: "complete_for_job_card", missingOptionalFacts: [
        "requested_date", "requested_window", "service_details",
      ] });
  });

  it.each([
    ["dry_cleaning", { buildingSlug: "b", serviceDetails: "two suits" }],
    ["car_detail", { buildingSlug: "b", requestedDate: "2026-06-27", vehicleDetails: "SUV" }],
    ["airport_transport", { requestedDate: "2026-06-27", origin: "Home", destination: "LAX", requestedWindow: "7am" }],
    ["apartment_cleaning", { buildingSlug: "b", requestedDate: "2026-06-27" }],
    ["guest_readiness", { buildingSlug: "b", deadlineDate: "2026-06-27", serviceDetails: "guest room" }],
    ["haircut", { buildingSlug: "b", requestedDate: "2026-06-27" }],
    ["handyman", { buildingSlug: "b", serviceDetails: "mount two shelves" }],
    ["other", { buildingSlug: "b", serviceDetails: "find a piano tuner" }],
  ] as const)("recognizes a complete %s job-card input", (category, facts) => {
    expect(evaluateRequestCompleteness({ category, facts })).toMatchObject({
      status: "complete_for_job_card", nextQuestion: null, mayCreateJobCard: true,
      maySourceVendor: false, mayBook: false,
    });
  });

  it("contains no IO, persistence, route, UI, worker, LLM, or execution behavior", () => {
    const source = readFileSync("server/procurement/requestCompletenessPolicy.ts", "utf8");
    expect(source).not.toMatch(/\b(fetch|axios|execute|query|insert|update|delete|invokeLLM)\s*\(/i);
    expect(source).not.toMatch(/\b(Router|worker|connector|stripe|twilio|sendgrid|openai|anthropic)\b/i);
    expect(source).not.toMatch(/CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE/i);
  });
});
