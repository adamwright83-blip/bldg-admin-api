import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateResidentProposalConsent } from "./residentProposalConsentPolicy";
import type { ResidentProposalPresentationContract, ResidentProposalReadiness } from "./residentProposalPresentationContract";

function card(patch: Partial<ResidentProposalPresentationContract> = {}): ResidentProposalPresentationContract {
  return {
    proposal_id: "proposal-1", proposal_version_id: "version-1", service_category: "dog_grooming",
    service_label: "Dog grooming", resident_safe_summary: "Dog grooming request",
    vendor_display_name: "Acme Grooming", vendor_source_display_type: "Public business directory",
    offered_window: { start: "2026-06-25T10:00:00.000Z", end: "2026-06-25T11:00:00.000Z", label: "Jun 25, 10-11am" },
    quoted_price: { amount_cents: 13500, currency: "USD", label: "Quoted $135.00" },
    proposal_expiry: "2026-07-01T00:00:00.000Z", readiness: "ready_for_resident",
    truth_language: { availability: "Available, not booked", authority: "Approve HELD to try to book",
      disclaimer: "Nothing is confirmed until provider acceptance is verified" },
    truth_flags: { available_not_booked: true, provider_not_accepted: true, not_paid: true,
      not_dispatched: true, not_completed: true },
    fit: null, reputation: null, evidence_labels: [],
    cta: { visible: true, primary_text: "Let HELD try to book this",
      reassurance: "Nothing is confirmed until the provider accepts.", authority_only: true },
    state_mutated: false, llm_called: false,
    ...patch,
  };
}

function baseInput(patch: Partial<Parameters<typeof evaluateResidentProposalConsent>[0]> = {}) {
  return {
    versionId: "version-1", bldgUserId: 1, tenantId: "default", hasExistingConsent: false, card: card(),
    ...patch,
  };
}

describe("evaluateResidentProposalConsent", () => {
  it("records consent for an eligible, owned, CTA-eligible proposal", () => {
    const decision = evaluateResidentProposalConsent(baseInput());
    expect(decision.outcome).toBe("consent_recorded");
    expect(decision.allowed).toBe(true);
  });

  it("returns consent_already_recorded for a replay, without re-validating the card", () => {
    const decision = evaluateResidentProposalConsent(baseInput({ hasExistingConsent: true, card: null }));
    expect(decision.outcome).toBe("consent_already_recorded");
    expect(decision.allowed).toBe(true);
  });

  it("refuses when the proposal is not owned (card is null)", () => {
    const decision = evaluateResidentProposalConsent(baseInput({ card: null }));
    expect(decision.outcome).toBe("consent_not_allowed");
    expect(decision.allowed).toBe(false);
  });

  it("refuses for every non-ready readiness state (expired, unavailable, unsafe, not_ready)", () => {
    const states: ResidentProposalReadiness[] = ["expired", "unavailable", "not_ready", "unsafe"];
    for (const readiness of states) {
      const decision = evaluateResidentProposalConsent(baseInput({ card: card({ readiness }) }));
      expect(decision.outcome).toBe("consent_not_allowed");
    }
  });

  it("refuses a superseded proposal the same way as not_ready (collapses to the same outcome the read store already uses)", () => {
    // The read store never returns a card for a superseded version -- it surfaces as card: null,
    // identical to "not owned." This is intentional: the API must not let a caller distinguish
    // "doesn't exist," "not yours," and "exists but superseded."
    const decision = evaluateResidentProposalConsent(baseInput({ card: null }));
    expect(decision.outcome).toBe("consent_not_allowed");
  });

  it("refuses a proposal that is ready but not CTA-eligible", () => {
    const decision = evaluateResidentProposalConsent(baseInput({
      card: card({ cta: { visible: false, primary_text: "Let HELD try to book this",
        reassurance: "Nothing is confirmed until the provider accepts.", authority_only: true } }),
    }));
    expect(decision.outcome).toBe("consent_not_allowed");
  });

  it("rejects malformed version ids before any lookup", () => {
    const decision = evaluateResidentProposalConsent(baseInput({ versionId: "../etc/passwd" }));
    expect(decision.outcome).toBe("invalid_request");
  });

  it("rejects missing bldgUserId or tenantId", () => {
    expect(evaluateResidentProposalConsent(baseInput({ bldgUserId: null })).outcome).toBe("invalid_request");
    expect(evaluateResidentProposalConsent(baseInput({ bldgUserId: 0 })).outcome).toBe("invalid_request");
    expect(evaluateResidentProposalConsent(baseInput({ tenantId: null })).outcome).toBe("invalid_request");
  });

  it("hardcodes no outreach/booking/payment/dispatch/provider-acceptance/LLM behavior on every decision", () => {
    const decisions = [
      evaluateResidentProposalConsent(baseInput()),
      evaluateResidentProposalConsent(baseInput({ card: null })),
      evaluateResidentProposalConsent(baseInput({ hasExistingConsent: true, card: null })),
    ];
    for (const decision of decisions) {
      expect(decision.outreachSent).toBe(false);
      expect(decision.vendorContacted).toBe(false);
      expect(decision.booked).toBe(false);
      expect(decision.accepted).toBe(false);
      expect(decision.paid).toBe(false);
      expect(decision.captured).toBe(false);
      expect(decision.dispatched).toBe(false);
      expect(decision.completed).toBe(false);
      expect(decision.llmCalled).toBe(false);
    }
  });
});

describe("resident proposal consent policy source isolation", () => {
  it("contains no fetch/axios/external calls, no LLM call, no route/UI/worker, no writes", () => {
    const source = fs.readFileSync("server/procurement/residentProposalConsentPolicy.ts", "utf8");
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/\baxios\b/);
    expect(source).not.toMatch(/openai|anthropic|chatgpt|generative text model/i);
    expect(source).not.toMatch(/router|app\.(get|post|put|delete)/i);
    expect(source).not.toMatch(/INSERT INTO|UPDATE\s+\w+|DELETE FROM/i);
  });
});
