import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { interpretVendorResponse } from "./vendorResponseInterpretationPolicy";

describe("interpretVendorResponse -- classifications", () => {
  it("declined response classifies as vendor_declined but does not globally reject candidate", () => {
    // declined via responseKind
    const decision1 = interpretVendorResponse({
      summary: "Some generic message.",
      rawPayload: {},
      responseKind: "declined",
    });
    expect(decision1.classification).toBe("vendor_declined");
    expect(decision1.allowed).toBe(true);
    // output does not globally reject candidate (no global candidate rejection properties exist)
    expect(Object.keys(decision1)).not.toContain("candidateGloballyRejected");
    expect(Object.keys(decision1)).not.toContain("rejectCandidate");

    // declined via summary keyword
    const decision2 = interpretVendorResponse({
      summary: "The vendor declined the work.",
      rawPayload: {},
    });
    expect(decision2.classification).toBe("vendor_declined");
  });

  it("availability response classifies as vendor_available but does not mean booked/accepted", () => {
    // availability via responseKind
    const decision1 = interpretVendorResponse({
      summary: "Some generic message.",
      rawPayload: {},
      responseKind: "availability",
    });
    expect(decision1.classification).toBe("vendor_available");
    expect(decision1.booked).toBe(false);
    expect(decision1.accepted).toBe(false);

    // availability via summary keyword
    const decision2 = interpretVendorResponse({
      summary: "We have an opening next Thursday.",
      rawPayload: {},
    });
    expect(decision2.classification).toBe("vendor_available");
    expect(decision2.booked).toBe(false);
    expect(decision2.accepted).toBe(false);
  });

  it("unavailable response classifies as vendor_unavailable but does not mean candidate globally rejected", () => {
    // unavailable via summary keyword
    const decision = interpretVendorResponse({
      summary: "We are currently unavailable and have no openings.",
      rawPayload: {},
    });
    expect(decision.classification).toBe("vendor_unavailable");
    expect(decision.allowed).toBe(true);
    expect(Object.keys(decision)).not.toContain("candidateGloballyRejected");
    expect(Object.keys(decision)).not.toContain("rejectCandidate");
  });

  it("rate info response classifies as vendor_rate_info_provided but does not mean payment/authorization/capture", () => {
    // rate info via responseKind
    const decision1 = interpretVendorResponse({
      summary: "Generic message.",
      rawPayload: {},
      responseKind: "rate_info",
    });
    expect(decision1.classification).toBe("vendor_rate_info_provided");
    expect(decision1.paid).toBe(false);
    expect(decision1.captured).toBe(false);

    // rate info via summary keyword
    const decision2 = interpretVendorResponse({
      summary: "The rate is $150 per hour.",
      rawPayload: {},
    });
    expect(decision2.classification).toBe("vendor_rate_info_provided");
    expect(decision2.paid).toBe(false);
    expect(decision2.captured).toBe(false);
  });

  it("clarification response classifies as vendor_needs_clarification", () => {
    const decision = interpretVendorResponse({
      summary: "Could you please clarify the details of the request?",
      rawPayload: {},
    });
    expect(decision.classification).toBe("vendor_needs_clarification");
    expect(decision.allowed).toBe(true);
  });

  it("unsupported response classifies as vendor_unsupported", () => {
    const decision = interpretVendorResponse({
      summary: "This request is outside our scope and unsupported.",
      rawPayload: {},
    });
    expect(decision.classification).toBe("vendor_unsupported");
    expect(decision.allowed).toBe(true);
  });

  it("general response classifies conservatively", () => {
    const decision = interpretVendorResponse({
      summary: "Hello, we received your message and will get back to you.",
      rawPayload: {},
    });
    expect(decision.classification).toBe("vendor_general_response");
    expect(decision.allowed).toBe(true);
  });
});

describe("interpretVendorResponse -- forbidden claims and fields", () => {
  it("rejects forbidden claims in the summary or rawPayload", () => {
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
      const decision = interpretVendorResponse({
        summary: `The vendor claims: ${phrase}`,
        rawPayload: {},
      });
      expect(decision.classification).toBe("response_invalid");
      expect(decision.allowed).toBe(false);
      expect(decision.reasons).toContain("forbidden_claim");
    }
  });

  it("rejects forbidden raw payload keys", () => {
    const forbiddenPayloadKeys = [
      "providerMessageId", "provider_message_id",
      "deliveryReceipt", "delivery_receipt",
      "sentByHeld", "sent_by_held",
      "automatedSend", "automated_send",
      "sentAt", "sent_at",
      "deliveryStatus", "delivery_status",
      "sendStatus", "send_status",
      "providerMessageCreated", "provider_message_created",
      "deliveryVerified", "delivery_verified",
    ];

    for (const key of forbiddenPayloadKeys) {
      const decision = interpretVendorResponse({
        summary: "Normal vendor response.",
        rawPayload: { [key]: "some-value" },
      });
      expect(decision.classification).toBe("response_invalid");
      expect(decision.allowed).toBe(false);
      expect(decision.reasons).toContain("forbidden_payload_field");
    }
  });

  it("provider-message id / delivery receipt rejected in summary", () => {
    const decisionId = interpretVendorResponse({
      summary: "We have providermessageid set to 123",
      rawPayload: {},
    });
    expect(decisionId.classification).toBe("response_invalid");
    expect(decisionId.allowed).toBe(false);

    const decisionReceipt = interpretVendorResponse({
      summary: "Delivery confirmation was received",
      rawPayload: {},
    });
    expect(decisionReceipt.classification).toBe("response_invalid");
    expect(decisionReceipt.allowed).toBe(false);
  });

  it("automated HELD send rejected", () => {
    const decision = interpretVendorResponse({
      summary: "we automatically sent the request.",
      rawPayload: {},
    });
    expect(decision.classification).toBe("response_invalid");
    expect(decision.allowed).toBe(false);
  });

  it("output hardcodes no booking/acceptance/dispatch/payment/capture/completion/execution", () => {
    const decision = interpretVendorResponse({
      summary: "We are available next week.",
      rawPayload: {},
      responseKind: "availability",
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

describe("vendor response interpretation policy source isolation", () => {
  it("contains no fetch/axios/external calls, no LLM call, no route/UI/worker, no SQL/DDL/migration files", () => {
    const source = fs.readFileSync("server/procurement/vendorResponseInterpretationPolicy.ts", "utf8");
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/\baxios\b/);
    expect(source).not.toMatch(/openai|anthropic|chatgpt|generative text model/i);
    expect(source).not.toMatch(/router|app\.(get|post|put|delete)/i);
    expect(source).not.toMatch(/INSERT INTO|UPDATE\s+\w+|DELETE FROM/i);
  });
});
