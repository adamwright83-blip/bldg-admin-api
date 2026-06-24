import { describe, expect, it } from "vitest";
import {
  buildContactAttempt,
  buildResponseTermsPacket,
  buildSimulatedReplyIntakePacket,
  evaluateContactAttemptSendGate,
  interpretVendorReply,
  markAttemptInterpreted,
  markAttemptReplyReceived,
  runNoopContactAttempt,
  validateReplyIntakePacket,
  type ContactAttempt,
} from "./vendorContactAttemptPolicy";
import type { OutreachDraft } from "./castingSprintExecutionPolicy";

function safeDraft(overrides?: Partial<OutreachDraft>): OutreachDraft {
  return {
    templateKey: "vendor_availability_request_v0",
    subject: "Availability check: Dog Grooming — 2026-06-23",
    body: "Hi Westside Mobile Pet Spa,\n\nThe resident approved HELD to check whether you can do this.\nNothing is confirmed yet.\nWe are confirming availability first.\n\nSpeak to HELD founder directly: Adam Wright — 323.807.4661 / Adam@bldg.chat.",
    truthLinesIncluded: [
      "The resident approved HELD to check whether you can do this.",
      "Nothing is confirmed yet.",
      "We are confirming availability first.",
      "Please reply with availability, price, and any requirements.",
    ],
    founderEscalationIncluded: true,
    forbiddenClaimsDetected: [],
    blockingLintRules: [],
    safeToCopy: true,
    sentByHeld: false,
    ...overrides,
  };
}

function attempt(overrides?: Partial<Parameters<typeof buildContactAttempt>[0]>): ContactAttempt {
  return buildContactAttempt({
    sourceKey: "service_request:155",
    candidateId: "candidate_1",
    leadId: "lead_1",
    lane: "maps_producer",
    channel: "email",
    draft: safeDraft(),
    recipientTarget: "vendor@example.com",
    now: new Date("2026-06-24T00:00:00.000Z"),
    ...overrides,
  });
}

describe("vendor contact attempt: send gate", () => {
  it("validates a safe draft passes the send gate", () => {
    const gate = evaluateContactAttemptSendGate(attempt());
    expect(gate.allowed).toBe(true);
    expect(gate.reasons).toEqual([]);
  });

  it("requires a contact method", () => {
    const gate = evaluateContactAttemptSendGate(attempt({ recipientTarget: "" }));
    expect(gate.allowed).toBe(false);
    expect(gate.reasons).toContain("contact_method_required");
  });

  it("requires a candidate or lead identity", () => {
    const gate = evaluateContactAttemptSendGate(attempt({ candidateId: null, leadId: null }));
    expect(gate.allowed).toBe(false);
    expect(gate.reasons).toContain("candidate_or_lead_identity_required");
  });

  it("blocks an unsafe or forbidden-claim draft", () => {
    const gate = evaluateContactAttemptSendGate(attempt({ draft: safeDraft({ safeToCopy: false, forbiddenClaimsDetected: ["forbidden_truth_claim_detected"] }) }));
    expect(gate.allowed).toBe(false);
    expect(gate.reasons).toContain("draft_not_safe_to_send");
    expect(gate.reasons).toContain("forbidden_claims_detected");
  });

  it("always blocks gated_provider_future, since no live provider layer exists yet", () => {
    const gate = evaluateContactAttemptSendGate(attempt({ automationMode: "gated_provider_future" }));
    expect(gate.allowed).toBe(false);
    expect(gate.reasons).toContain("live_provider_not_enabled");
  });
});

describe("vendor contact attempt: no-op provider", () => {
  it("never invokes a real outbound provider and does not send real email/SMS/call/form", () => {
    const result = runNoopContactAttempt(attempt());
    expect(result.providerResult).not.toBeNull();
    expect(result.providerResult!.liveProviderInvoked).toBe(false);
    expect(result.providerResult!.warnings.length).toBeGreaterThan(0);
    expect(result.attempt.liveProviderInvoked).toBe(false);
    expect(result.attempt.outreachSentByHeld).toBe(false);
    expect(["sent_noop", "queued_noop"]).toContain(result.providerResult!.status);
  });

  it("moves the attempt status to response_pending once HELD has executed the no-op provider path", () => {
    const result = runNoopContactAttempt(attempt());
    expect(result.attempt.status).toBe("response_pending");
    expect(result.attempt.gatePassed).toBe(true);
  });

  it("returns blocked status and reasons instead of dispatching when the gate fails", () => {
    const result = runNoopContactAttempt(attempt({ recipientTarget: "" }));
    expect(result.attempt.status).toBe("blocked");
    expect(result.attempt.gatePassed).toBe(false);
    expect(result.providerResult).toBeNull();
    expect(result.blockedReasons).toContain("contact_method_required");
  });

  it("never marks provider acceptance, booking, payment, or dispatch", () => {
    const result = runNoopContactAttempt(attempt());
    expect(result.attempt.providerAccepted).toBe(false);
    expect(result.attempt.bookingConfirmed).toBe(false);
    expect(result.attempt.paymentAuthorized).toBe(false);
    expect(result.attempt.dispatched).toBe(false);
  });
});

describe("vendor contact attempt: reply received and interpreted transitions", () => {
  it("marks reply received without claiming provider acceptance", () => {
    const ran = runNoopContactAttempt(attempt());
    const received = markAttemptReplyReceived(ran.attempt);
    expect(received.status).toBe("reply_received");
    expect(received.providerAccepted).toBe(false);
  });

  it("marks interpreted with providerResponded true only when not blocked", () => {
    const ran = runNoopContactAttempt(attempt());
    const interpreted = markAttemptInterpreted(ran.attempt, false);
    expect(interpreted.status).toBe("interpreted");
    expect(interpreted.providerResponded).toBe(true);

    const blocked = markAttemptInterpreted(ran.attempt, true);
    expect(blocked.status).toBe("blocked");
    expect(blocked.providerResponded).toBe(false);
  });
});

describe("vendor reply intake", () => {
  it("accepts a raw simulated reply packet", () => {
    const packet = buildSimulatedReplyIntakePacket({
      attemptId: "attempt_1", candidateId: "candidate_1", sourceKey: "service_request:155",
      channel: "email", rawReplyText: "Yes we're available that day, $110 for a boxer.",
    });
    const validation = validateReplyIntakePacket(packet);
    expect(validation.valid).toBe(true);
    expect(packet.inboundProvider).toBe("noop_test");
  });

  it("requires the core fields before a packet is considered valid", () => {
    const validation = validateReplyIntakePacket({ attemptId: "", sourceKey: "service_request:155", rawReplyText: "" });
    expect(validation.valid).toBe(false);
    expect(validation.reasons).toContain("attempt_id_required");
    expect(validation.reasons).toContain("raw_reply_text_required");
  });
});

describe("vendor reply interpreter", () => {
  function packet(rawReplyText: string) {
    return buildSimulatedReplyIntakePacket({
      attemptId: "attempt_1", candidateId: "candidate_1", sourceKey: "service_request:155",
      channel: "email", rawReplyText,
    });
  }

  it("classifies an available reply", () => {
    const reply = interpretVendorReply({ packet: packet("We have an opening that day and can do it, $110.") });
    expect(reply.classification).toBe("available");
    expect(reply.availableNotAccepted).toBe(true);
  });

  it("classifies an unavailable reply", () => {
    const reply = interpretVendorReply({ packet: packet("Sorry, we have no openings that week, we're out of office.") });
    expect(reply.classification).toBe("unavailable");
  });

  it("classifies a needs_more_info reply", () => {
    const reply = interpretVendorReply({ packet: packet("Can you clarify what breed and what time you need?") });
    expect(reply.classification).toBe("needs_more_info");
  });

  it("distinguishes available from accepted: never returns an accepted outcome", () => {
    const reply = interpretVendorReply({ packet: packet("We have an opening that day and can do it, $110.") });
    expect(reply.classification).not.toBe("accepted" as never);
    expect(reply.availableNotAccepted).toBe(true);
  });

  it("classifies a normal decline as do_not_contact", () => {
    const reply = interpretVendorReply({ packet: packet("We are not interested, please do not contact us again.") });
    expect(reply.classification).toBe("do_not_contact");
    expect(reply.blocked).toBe(false);
  });

  it("blocks a reply containing a forbidden claim instead of interpreting it as truth", () => {
    const reply = interpretVendorReply({ packet: packet("We accepted the booking and it is confirmed.") });
    expect(reply.blocked).toBe(true);
    expect(reply.classification).toBe("do_not_contact");
  });

  it("extracts a price quote and upfront-payment signal when present", () => {
    const reply = interpretVendorReply({ packet: packet("We can do it for $125, but we need a deposit up front.") });
    expect(reply.extractedQuote).toMatchObject({ amount: 125, currency: "USD" });
    expect(reply.upfrontPaymentRequired).toBe(true);
  });
});

describe("response terms packet bridge", () => {
  it("keeps inquiryOnlyNotBooking true and never marks provider acceptance, booking, payment, or dispatch", () => {
    const result = buildResponseTermsPacket({
      attemptId: "attempt_1", candidateId: "candidate_1",
      rawReplyText: "We have an opening that day and can do it, $110.",
    });
    expect(result.allowed).toBe(true);
    if (!result.allowed) throw new Error("expected allowed");
    expect(result.packet.inquiryOnlyNotBooking).toBe(true);
    expect(result.packet.providerAccepted).toBe(false);
    expect(result.packet.bookingConfirmed).toBe(false);
    expect(result.packet.paymentAuthorized).toBe(false);
    expect(result.packet.dispatched).toBe(false);
    expect(result.packet.residentProposalReady).toBe(false);
  });

  it("distinguishes available from accepted in the availability status field", () => {
    const result = buildResponseTermsPacket({
      attemptId: "attempt_1", candidateId: "candidate_1",
      rawReplyText: "We have an opening that day and can do it, $110.",
    });
    expect(result.allowed).toBe(true);
    if (!result.allowed) throw new Error("expected allowed");
    expect(result.packet.availabilityStatus).toBe("available");
    expect(result.packet.providerAccepted).toBe(false);
  });

  it("never marks proposal resident-ready even when admin-review-ready", () => {
    const result = buildResponseTermsPacket({
      attemptId: "attempt_1", candidateId: "candidate_1",
      rawReplyText: "We have an opening that day and can do it, $110.",
    });
    expect(result.allowed).toBe(true);
    if (!result.allowed) throw new Error("expected allowed");
    expect(result.packet.readyForAdminProposalReview).toBe(true);
    expect(result.packet.residentProposalReady).toBe(false);
  });

  it("refuses to build a packet from a reply containing a forbidden claim", () => {
    const result = buildResponseTermsPacket({
      attemptId: "attempt_1", candidateId: "candidate_1",
      rawReplyText: "It is booked and accepted.",
    });
    expect(result.allowed).toBe(false);
    expect(result.packet).toBeNull();
  });
});
