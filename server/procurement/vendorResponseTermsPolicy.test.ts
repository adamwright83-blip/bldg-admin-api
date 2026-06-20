import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateVendorResponseTerms } from "./vendorResponseTermsPolicy";

const NOW = new Date("2026-06-20T12:00:00.000Z");

function baseEventInput(patch: Partial<Parameters<typeof evaluateVendorResponseTerms>[0]["event"]> = {}) {
  return {
    id: "event-1",
    workflowId: "workflow-1",
    candidateId: "candidate-1",
    occurredAt: new Date("2026-06-20T11:00:00.000Z"),
    createdBy: "operator-1",
    summary: "Vendor replied with pricing and availability details.",
    rawPayload: {},
    ...patch,
  };
}

function baseInterpretationInput(patch: Partial<Parameters<typeof evaluateVendorResponseTerms>[0]["interpretation"]> = {}) {
  return {
    classification: "vendor_general_response" as const,
    allowed: true,
    reasons: [],
    booked: false as const,
    accepted: false as const,
    dispatched: false as const,
    paid: false as const,
    captured: false as const,
    completed: false as const,
    selectedForExecution: false as const,
    providerMessageCreated: false as const,
    deliveryVerified: false as const,
    ...patch,
  };
}

describe("evaluateVendorResponseTerms -- logic cases", () => {
  it("declined response stores declined terms but does not globally reject candidate", () => {
    const decision = evaluateVendorResponseTerms({
      interpretation: baseInterpretationInput({ classification: "vendor_declined" }),
      event: baseEventInput({ summary: "We decline the invitation." }),
      now: NOW,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.terms).not.toBeNull();
    expect(decision.terms!.interpretationStatus).toBe("declined");
    expect(decision.terms!.availabilityStatus).toBe("unavailable");
    expect(decision.proposalReady).toBe(false);

    // No global candidate rejection columns
    expect(Object.keys(decision)).not.toContain("candidateGloballyRejected");
    expect(Object.keys(decision.terms!)).not.toContain("candidateGloballyRejected");
  });

  it("availability stores availability terms but does not mean booked/accepted", () => {
    const decision = evaluateVendorResponseTerms({
      interpretation: baseInterpretationInput({ classification: "vendor_available" }),
      event: baseEventInput({
        summary: "Available next week.",
        rawPayload: { availabilityWindows: [{ start: "2026-06-21T09:00:00Z", end: "2026-06-21T17:00:00Z" }] },
      }),
      now: NOW,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.terms!.interpretationStatus).toBe("interpreted");
    expect(decision.terms!.availabilityStatus).toBe("available");
    expect(decision.terms!.availabilityWindowsJson).toHaveLength(1);
    expect(decision.proposalReady).toBe(true);
    expect(decision.booked).toBe(false);
    expect(decision.accepted).toBe(false);
  });

  it("rate info stores rate terms but does not mean payment/authorization/capture", () => {
    const decision = evaluateVendorResponseTerms({
      interpretation: baseInterpretationInput({ classification: "vendor_rate_info_provided" }),
      event: baseEventInput({
        summary: "We charge $120 per hour.",
        rawPayload: { quotedAmount: 120, rateUnit: "hour", quotedCurrency: "USD" },
      }),
      now: NOW,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.terms!.interpretationStatus).toBe("interpreted");
    expect(decision.terms!.rateStatus).toBe("provided");
    expect(decision.terms!.quotedAmount).toBe(120);
    expect(decision.terms!.quotedCurrency).toBe("USD");
    expect(decision.terms!.rateUnit).toBe("hour");
    expect(decision.proposalReady).toBe(false); // No availability provided
    expect(decision.paid).toBe(false);
    expect(decision.captured).toBe(false);
  });

  it("clarification/unsupported fail closed for proposal readiness", () => {
    // clarification
    const decision1 = evaluateVendorResponseTerms({
      interpretation: baseInterpretationInput({ classification: "vendor_needs_clarification" }),
      event: baseEventInput({ summary: "Need more details." }),
      now: NOW,
    });
    expect(decision1.terms!.interpretationStatus).toBe("needs_clarification");
    expect(decision1.proposalReady).toBe(false);

    // unsupported
    const decision2 = evaluateVendorResponseTerms({
      interpretation: baseInterpretationInput({ classification: "vendor_unsupported" }),
      event: baseEventInput({ summary: "We do not offer this service." }),
      now: NOW,
    });
    expect(decision2.terms!.interpretationStatus).toBe("unsupported");
    expect(decision2.proposalReady).toBe(false);
  });

  it("expired terms are not proposal-ready", () => {
    const decision = evaluateVendorResponseTerms({
      interpretation: baseInterpretationInput({ classification: "vendor_available" }),
      event: baseEventInput({
        summary: "Available tomorrow.",
        rawPayload: {
          availabilityWindows: [{ start: "2026-06-21T09:00:00Z" }],
          expiresAt: "2026-06-19T12:00:00.000Z", // Expired
        },
      }),
      now: NOW,
    });

    expect(decision.terms!.expiresAt).not.toBeNull();
    expect(decision.proposalReady).toBe(false);
  });

  it("invalid interpretation is rejected", () => {
    const decision = evaluateVendorResponseTerms({
      interpretation: baseInterpretationInput({ classification: "response_invalid", allowed: false }),
      event: baseEventInput(),
      now: NOW,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.terms).toBeNull();
    expect(decision.proposalReady).toBe(false);
  });
});

describe("evaluateVendorResponseTerms -- forbidden claims and fields", () => {
  it("rejects forbidden claims in the event summary or rawPayload", () => {
    const forbiddenPhrases = [
      "booked",
      "accepted",
      "dispatched",
      "paid",
      "captured",
      "completed",
      "selected for execution",
      "provider message id",
      "delivery receipt",
      "held sent",
      "we sent",
      "guaranteed provider commitment",
    ];

    for (const phrase of forbiddenPhrases) {
      const decision = evaluateVendorResponseTerms({
        interpretation: baseInterpretationInput(),
        event: baseEventInput({ summary: `Update: ${phrase}` }),
        now: NOW,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reasons).toContain("forbidden_claim");
    }
  });

  it("hardcodes false/no for forbidden state fields", () => {
    const decision = evaluateVendorResponseTerms({
      interpretation: baseInterpretationInput({ classification: "vendor_available" }),
      event: baseEventInput({
        rawPayload: { availabilityWindows: [{ start: "2026-06-21" }] },
      }),
      now: NOW,
    });
    expect(decision.booked).toBe(false);
    expect(decision.accepted).toBe(false);
    expect(decision.dispatched).toBe(false);
    expect(decision.paid).toBe(false);
    expect(decision.captured).toBe(false);
    expect(decision.completed).toBe(false);
    expect(decision.selectedForExecution).toBe(false);
    expect(decision.providerMessageCreated).toBe(false);
    expect(decision.deliveryVerified).toBe(false);
  });
});

describe("vendor response terms policy source isolation", () => {
  it("contains no fetch/axios/external calls, no LLM call, no route/UI/worker, no SQL/DDL/migration files", () => {
    const source = fs.readFileSync("server/procurement/vendorResponseTermsPolicy.ts", "utf8");
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/\baxios\b/);
    expect(source).not.toMatch(/openai|anthropic|chatgpt|generative text model/i);
    expect(source).not.toMatch(/router|app\.(get|post|put|delete)/i);
    expect(source).not.toMatch(/INSERT INTO|UPDATE\s+\w+|DELETE FROM/i);
  });
});
