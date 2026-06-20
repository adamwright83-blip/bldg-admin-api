import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateManualOutreachEvent } from "./vendorManualOutreachEventPolicy";

const NOW = new Date("2026-06-20T12:00:00.000Z");

function baseInput(patch: Partial<Parameters<typeof evaluateManualOutreachEvent>[0]> = {}) {
  return {
    eventType: "manual_send" as const,
    candidateId: "candidate-1", workflowId: "workflow-1", draftId: "draft-1",
    sendReviewStatus: "operator_approved_for_manual_send_only",
    summary: "Called the vendor to check availability for next week.",
    occurredAt: new Date("2026-06-20T10:00:00.000Z"),
    rawPayload: { note: "left voicemail" },
    now: NOW,
    ...patch,
  };
}

describe("evaluateManualOutreachEvent -- manual send logging", () => {
  it("logs a manual send only after operator_approved_for_manual_send_only", () => {
    const decision = evaluateManualOutreachEvent(baseInput());
    expect(decision.outcome).toBe("manual_outreach_logged");
    expect(decision.allowed).toBe(true);
    expect(decision.direction).toBe("outbound_manual_note");
    expect(decision.eventStatus).toBe("recorded");
  });

  it("a pending, rejected, or not_allowed send review cannot log a manual send", () => {
    for (const sendReviewStatus of [
      "awaiting_operator_send_review", "operator_rejected_send", "send_review_not_allowed",
      "send_review_requirements_missing", null,
    ]) {
      const decision = evaluateManualOutreachEvent(baseInput({ sendReviewStatus }));
      expect(decision.outcome).toBe("invalid_manual_event");
      expect(decision.allowed).toBe(false);
    }
  });

  it("a manual send event is human/manual only, never a HELD automated send", () => {
    const decision = evaluateManualOutreachEvent(baseInput());
    expect(decision.direction).toBe("outbound_manual_note");
    expect(decision.sentByHeld).toBe(false);
  });

  it("requires a draft id for a manual send", () => {
    const decision = evaluateManualOutreachEvent(baseInput({ draftId: null }));
    expect(decision.outcome).toBe("invalid_manual_event");
    expect(decision.reasons).toContain("missing_draft_id");
  });
});

describe("evaluateManualOutreachEvent -- vendor response logging", () => {
  it("a vendor response can be logged against an existing draft context", () => {
    const decision = evaluateManualOutreachEvent(baseInput({
      eventType: "vendor_response", responseKind: "general", sendReviewStatus: null,
      summary: "Vendor replied asking for more details.",
    }));
    expect(decision.outcome).toBe("vendor_response_logged");
    expect(decision.direction).toBe("inbound");
    expect(decision.allowed).toBe(true);
  });

  it("a vendor decline is logged without globally rejecting the candidate", () => {
    const decision = evaluateManualOutreachEvent(baseInput({
      eventType: "vendor_response", responseKind: "declined", sendReviewStatus: null,
      summary: "Vendor declined this particular request.",
    }));
    expect(decision.outcome).toBe("vendor_declined_logged");
    expect(decision.allowed).toBe(true);
    expect(Object.keys(decision)).not.toContain("candidateGloballyRejected");
  });

  it("availability info does not mean booked or accepted", () => {
    const decision = evaluateManualOutreachEvent(baseInput({
      eventType: "vendor_response", responseKind: "availability", sendReviewStatus: null,
      summary: "Vendor said they have openings next Tuesday.",
    }));
    expect(decision.outcome).toBe("vendor_availability_logged");
    expect(decision.booked).toBe(false);
    expect(decision.accepted).toBe(false);
  });

  it("rate info does not mean payment authorization or capture", () => {
    const decision = evaluateManualOutreachEvent(baseInput({
      eventType: "vendor_response", responseKind: "rate_info", sendReviewStatus: null,
      summary: "Vendor quoted an hourly rate.",
    }));
    expect(decision.outcome).toBe("vendor_rate_info_logged");
    expect(decision.paid).toBe(false);
    expect(decision.captured).toBe(false);
  });

  it("requires a draft id for vendor response context", () => {
    const decision = evaluateManualOutreachEvent(baseInput({
      eventType: "vendor_response", responseKind: "general", draftId: null, sendReviewStatus: null,
    }));
    expect(decision.outcome).toBe("invalid_manual_event");
    expect(decision.reasons).toContain("missing_draft_id_for_vendor_response_context");
  });

  it("requires a response kind for vendor response logging", () => {
    const decision = evaluateManualOutreachEvent(baseInput({
      eventType: "vendor_response", responseKind: undefined, sendReviewStatus: null,
    }));
    expect(decision.outcome).toBe("invalid_manual_event");
    expect(decision.reasons).toContain("missing_response_kind");
  });
});

describe("evaluateManualOutreachEvent -- forbidden claims and fields", () => {
  it("rejects forbidden claims in the summary or payload", () => {
    const bannedPhrases = [
      "vendor booked", "job accepted", "crew dispatched", "invoice paid",
      "payment captured", "job completed", "selected for execution",
    ];
    for (const phrase of bannedPhrases) {
      const decision = evaluateManualOutreachEvent(baseInput({ summary: `Update: ${phrase}.` }));
      expect(decision.outcome).toBe("invalid_manual_event");
      expect(decision.reasons).toContain("forbidden_claim");
    }
  });

  it("rejects a provider-message id or delivery receipt claim", () => {
    const decision1 = evaluateManualOutreachEvent(baseInput({ summary: "provider message id abc123" }));
    expect(decision1.outcome).toBe("invalid_manual_event");

    const decision2 = evaluateManualOutreachEvent(baseInput({ summary: "got a delivery receipt" }));
    expect(decision2.outcome).toBe("invalid_manual_event");
  });

  it("rejects forbidden raw payload fields", () => {
    const decision = evaluateManualOutreachEvent(baseInput({
      rawPayload: { providerMessageId: "abc-123" },
    }));
    expect(decision.outcome).toBe("invalid_manual_event");
    expect(decision.reasons).toContain("forbidden_payload_field");
  });

  it("hardcodes no HELD send, provider-message, delivery, payment, dispatch, or completion on every decision", () => {
    const decisions = [
      evaluateManualOutreachEvent(baseInput()),
      evaluateManualOutreachEvent(baseInput({ sendReviewStatus: "awaiting_operator_send_review" })),
      evaluateManualOutreachEvent(baseInput({
        eventType: "vendor_response", responseKind: "declined", sendReviewStatus: null,
      })),
    ];
    for (const decision of decisions) {
      expect(decision.sentByHeld).toBe(false);
      expect(decision.providerMessageCreated).toBe(false);
      expect(decision.deliveryAttemptedByHeld).toBe(false);
      expect(decision.booked).toBe(false);
      expect(decision.accepted).toBe(false);
      expect(decision.dispatched).toBe(false);
      expect(decision.paid).toBe(false);
      expect(decision.captured).toBe(false);
      expect(decision.completed).toBe(false);
    }
  });

  it("rejects missing candidate id, workflow id, summary, or invalid/future occurred_at", () => {
    expect(evaluateManualOutreachEvent(baseInput({ candidateId: null })).outcome).toBe("invalid_manual_event");
    expect(evaluateManualOutreachEvent(baseInput({ workflowId: null })).outcome).toBe("invalid_manual_event");
    expect(evaluateManualOutreachEvent(baseInput({ summary: "   " })).outcome).toBe("invalid_manual_event");
    expect(evaluateManualOutreachEvent(baseInput({ occurredAt: new Date("2026-06-21T00:00:00.000Z") })).outcome)
      .toBe("invalid_manual_event");
  });
});

describe("vendor manual outreach event policy source isolation", () => {
  it("contains no fetch/axios/external calls, no LLM call, no route/UI/worker, no writes", () => {
    const source = fs.readFileSync("server/procurement/vendorManualOutreachEventPolicy.ts", "utf8");
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/\baxios\b/);
    expect(source).not.toMatch(/openai|anthropic|chatgpt|generative text model/i);
    expect(source).not.toMatch(/router|app\.(get|post|put|delete)/i);
    expect(source).not.toMatch(/INSERT INTO|UPDATE\s+\w+|DELETE FROM/i);
  });
});
