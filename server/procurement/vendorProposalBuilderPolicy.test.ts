import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { buildVendorProposal } from "./vendorProposalBuilderPolicy";

const NOW = new Date("2026-06-20T12:00:00.000Z");

const requestContext = {
  workflowId: "workflow-1",
  serviceType: "laundry",
  accessPattern: "resident_present",
};

const constraints = {
  maxPriceCents: 15000, // $150.00
  scheduledAt: new Date("2026-06-21T10:00:00.000Z"),
};

const candidateContext = {
  candidateId: "candidate-1",
};

const validTerms = {
  id: "terms-1",
  interpretationStatus: "interpreted" as const,
  availabilityStatus: "available" as const,
  rateStatus: "provided" as const,
  quotedAmount: 120.0, // $120.00
  quotedCurrency: "USD",
  rateUnit: "hour",
  availabilityWindowsJson: [
    { start: "2026-06-21T08:00:00Z", end: "2026-06-21T17:00:00Z" },
  ],
  confidence: "high" as const,
  observedAt: new Date("2026-06-20T10:00:00.000Z"),
  expiresAt: new Date("2026-06-22T12:00:00.000Z"),
  createdBy: "operator-1",
};

describe("buildVendorProposal -- logic cases", () => {
  it("available terms can produce proposal_ready_for_review without booking/acceptance", () => {
    const decision = buildVendorProposal({
      termsList: [validTerms],
      requestContext,
      constraints,
      candidateContext,
      now: NOW,
    });

    expect(decision.status).toBe("proposal_ready_for_review");
    expect(decision.allowed).toBe(true);
    expect(decision.proposalDetails).not.toBeNull();
    expect(decision.proposalDetails!.quotedAmountCents).toBe(12000);
    expect(decision.proposalDetails!.currency).toBe("USD");
    expect(decision.booked).toBe(false);
    expect(decision.accepted).toBe(false);
  });

  it("rate terms can appear in proposal without payment/authorization/capture/payable", () => {
    const decision = buildVendorProposal({
      termsList: [validTerms],
      requestContext,
      constraints,
      candidateContext,
      now: NOW,
    });

    expect(decision.proposalDetails!.quotedAmountCents).toBe(12000);
    expect(decision.paid).toBe(false);
    expect(decision.captured).toBe(false);
    expect(decision.paymentAuthorized).toBe(false);
    expect(decision.paymentCaptured).toBe(false);
    expect(decision.payableCreated).toBe(false);
  });

  it("declined terms produce proposal_vendor_declined but do not globally reject candidate", () => {
    const declinedTerms = {
      ...validTerms,
      id: "terms-2",
      interpretationStatus: "declined" as const,
      availabilityStatus: "unavailable" as const,
    };

    const decision = buildVendorProposal({
      termsList: [declinedTerms],
      requestContext,
      constraints,
      candidateContext,
      now: NOW,
    });

    expect(decision.status).toBe("proposal_vendor_declined");
    expect(decision.allowed).toBe(false);
    expect(Object.keys(decision)).not.toContain("candidateGloballyRejected");
  });

  it("unsupported terms produce proposal_unsupported", () => {
    const unsupportedTerms = {
      ...validTerms,
      interpretationStatus: "unsupported" as const,
    };

    const decision = buildVendorProposal({
      termsList: [unsupportedTerms],
      requestContext,
      constraints,
      candidateContext,
      now: NOW,
    });

    expect(decision.status).toBe("proposal_unsupported");
    expect(decision.allowed).toBe(false);
  });

  it("needs clarification produces proposal_needs_clarification", () => {
    const clarificationTerms = {
      ...validTerms,
      interpretationStatus: "needs_clarification" as const,
    };

    const decision = buildVendorProposal({
      termsList: [clarificationTerms],
      requestContext,
      constraints,
      candidateContext,
      now: NOW,
    });

    expect(decision.status).toBe("proposal_needs_clarification");
  });

  it("expired terms fail closed", () => {
    const expiredTerms = {
      ...validTerms,
      expiresAt: new Date("2026-06-19T12:00:00.000Z"),
    };

    const decision = buildVendorProposal({
      termsList: [expiredTerms],
      requestContext,
      constraints,
      candidateContext,
      now: NOW,
    });

    expect(decision.status).toBe("proposal_requirements_missing");
    expect(decision.reasons).toContain("response_terms_expired");
  });

  it("missing required availability/rate fails closed", () => {
    // missing rate
    const missingRate = {
      ...validTerms,
      rateStatus: "not_provided" as const,
      quotedAmount: null,
    };

    const decision1 = buildVendorProposal({
      termsList: [missingRate],
      requestContext,
      constraints,
      candidateContext,
      now: NOW,
    });
    expect(decision1.status).toBe("proposal_requirements_missing");
    expect(decision1.reasons).toContain("rate_info_missing");

    // missing availability windows
    const missingWindows = {
      ...validTerms,
      availabilityWindowsJson: [],
    };
    const decision2 = buildVendorProposal({
      termsList: [missingWindows],
      requestContext,
      constraints,
      candidateContext,
      now: NOW,
    });
    expect(decision2.status).toBe("proposal_requirements_missing");
    expect(decision2.reasons).toContain("availability_windows_missing");
  });

  it("schedule mismatch fails closed", () => {
    const mismatchConstraints = {
      ...constraints,
      scheduledAt: new Date("2026-06-25T10:00:00.000Z"), // outside window
    };

    const decision = buildVendorProposal({
      termsList: [validTerms],
      requestContext,
      constraints: mismatchConstraints,
      candidateContext,
      now: NOW,
    });
    expect(decision.status).toBe("proposal_requirements_missing");
    expect(decision.reasons).toContain("schedule_mismatch");
  });

  it("price exceeding budget constraint fails closed", () => {
    const tightConstraints = {
      ...constraints,
      maxPriceCents: 5000, // budget is $50.00, quote is $120.00
    };

    const decision = buildVendorProposal({
      termsList: [validTerms],
      requestContext,
      constraints: tightConstraints,
      candidateContext,
      now: NOW,
    });
    expect(decision.status).toBe("proposal_requirements_missing");
    expect(decision.reasons).toContain("quoted_price_exceeds_budget_constraint");
  });
});

describe("buildVendorProposal -- tie-breakers and risk checks", () => {
  it("deterministic tie-break across multiple terms", () => {
    const olderTerms = {
      ...validTerms,
      id: "terms-old",
      observedAt: new Date("2026-06-20T08:00:00.000Z"),
      quotedAmount: 110.0,
    };
    const newerTerms = {
      ...validTerms,
      id: "terms-new",
      observedAt: new Date("2026-06-20T11:00:00.000Z"), // newer
      quotedAmount: 120.0,
    };

    const decision = buildVendorProposal({
      termsList: [olderTerms, newerTerms],
      requestContext,
      constraints,
      candidateContext,
      now: NOW,
    });

    // selects newer terms
    expect(decision.selectedTermsId).toBe("terms-new");
    expect(decision.proposalDetails!.quotedAmountCents).toBe(12000);
  });

  it("non-expired over expired tie-break", () => {
    const expiredTerms = {
      ...validTerms,
      id: "terms-expired",
      observedAt: new Date("2026-06-20T11:00:00.000Z"),
      expiresAt: new Date("2026-06-19T12:00:00.000Z"), // expired
    };
    const activeTerms = {
      ...validTerms,
      id: "terms-active",
      observedAt: new Date("2026-06-20T08:00:00.000Z"), // older but active
      expiresAt: new Date("2026-06-22T12:00:00.000Z"),
    };

    const decision = buildVendorProposal({
      termsList: [expiredTerms, activeTerms],
      requestContext,
      constraints,
      candidateContext,
      now: NOW,
    });

    expect(decision.selectedTermsId).toBe("terms-active");
    expect(decision.status).toBe("proposal_ready_for_review");
  });

  it("low confidence triggers risk flag", () => {
    const lowConfTerms = {
      ...validTerms,
      confidence: "low" as const,
    };

    const decision = buildVendorProposal({
      termsList: [lowConfTerms],
      requestContext,
      constraints,
      candidateContext,
      now: NOW,
    });
    expect(decision.riskFlags).toContain("low_confidence_terms");
  });

  it("expiring soon triggers risk flag", () => {
    const expiringSoonTerms = {
      ...validTerms,
      expiresAt: new Date("2026-06-20T13:00:00.000Z"), // 1 hour from NOW
    };

    const decision = buildVendorProposal({
      termsList: [expiringSoonTerms],
      requestContext,
      constraints,
      candidateContext,
      now: NOW,
    });
    expect(decision.riskFlags).toContain("expires_soon");
  });

  it("rejects forbidden claims in selected terms text", () => {
    const badTerms = {
      ...validTerms,
      createdBy: "operator booked the job", // forbidden word 'booked'
    };

    const decision = buildVendorProposal({
      termsList: [badTerms],
      requestContext,
      constraints,
      candidateContext,
      now: NOW,
    });
    expect(decision.status).toBe("proposal_not_allowed");
    expect(decision.reasons).toContain("forbidden_claim");
  });

  it("hardcodes false/no for forbidden state properties", () => {
    const decision = buildVendorProposal({
      termsList: [validTerms],
      requestContext,
      constraints,
      candidateContext,
      now: NOW,
    });

    expect(decision.booked).toBe(false);
    expect(decision.accepted).toBe(false);
    expect(decision.dispatched).toBe(false);
    expect(decision.paid).toBe(false);
    expect(decision.captured).toBe(false);
    expect(decision.completed).toBe(false);
    expect(decision.selectedForExecution).toBe(false);
    expect(decision.providerAccepted).toBe(false);
    expect(decision.bookingVerified).toBe(false);
    expect(decision.paymentAuthorized).toBe(false);
    expect(decision.paymentCaptured).toBe(false);
    expect(decision.invoiceCreated).toBe(false);
    expect(decision.payableCreated).toBe(false);
  });
});

describe("vendor proposal builder policy source isolation", () => {
  it("contains no fetch/axios/external calls, no LLM call, no route/UI/worker, no SQL/DDL/migration files", () => {
    const source = fs.readFileSync("server/procurement/vendorProposalBuilderPolicy.ts", "utf8");
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/\baxios\b/);
    expect(source).not.toMatch(/openai|anthropic|chatgpt|generative text model/i);
    expect(source).not.toMatch(/router|app\.(get|post|put|delete)/i);
    expect(source).not.toMatch(/INSERT INTO|UPDATE\s+\w+|DELETE FROM/i);
  });
});
