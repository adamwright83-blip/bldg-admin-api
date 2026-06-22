import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildRequestJobCard } from "./requestJobCardPolicy";
import { evaluateVendorOptionEligibility, type VendorOptionEligibilityInput } from "./vendorOptionEligibilityPolicy";

const NOW = new Date("2026-06-22T12:00:00.000Z");

function input(patch: Partial<VendorOptionEligibilityInput> = {}): VendorOptionEligibilityInput {
  const jobCard = buildRequestJobCard({
    serviceIntent: "dog_grooming",
    rawRequest: "Can you get Milo groomed Friday?",
    residentContext: { buildingSlug: "the-wright", unit: "4B" },
    facts: { requestedDate: "2026-06-26", dog: { breed: "Poodle" }, buildingSlug: "the-wright" },
    source: { sourceType: "service_request", sourceId: "12" },
    now: NOW,
  });
  return {
    jobCard,
    candidate: {
      candidateId: "candidate-1", businessName: "Milo Grooming", serviceCategory: "dog_grooming",
      sourceStatus: "approved_for_outreach", sourceApproved: true,
      rating: 4.8, reviewCount: 120, distanceKm: 2, servesRequestedArea: true,
      estimatedPriceCents: 8500, reliabilityScore: 0.95,
      evidenceRows: [{
        id: "evidence-1", candidateId: "candidate-1", sourceType: "public_business_directory",
        sourceKey: "google_business_profiles", evidenceStatus: "usable", rating: 4.8,
        ratingScaleMin: 0, ratingScaleMax: 5, reviewCount: 120, sourceConfidence: "trusted",
        sourceApproved: true, observedAt: new Date("2026-06-20T12:00:00.000Z"),
        expiresAt: new Date("2026-07-20T12:00:00.000Z"), evidencePayload: {}, complianceSnapshot: {},
      }],
    },
    preferences: { minimumRating: 4, minimumSourceConfidence: 0.8, maximumBudgetCents: 10000, requireServiceArea: true },
    terms: [{
      id: "terms-1", interpretationStatus: "interpreted", availabilityStatus: "available",
      rateStatus: "provided", quotedAmount: 85, quotedCurrency: "USD", rateUnit: "service",
      availabilityWindowsJson: [{ start: "2026-06-26T09:00:00.000Z", end: "2026-06-26T17:00:00.000Z" }],
      confidence: "high", observedAt: NOW, expiresAt: new Date("2026-06-25T12:00:00.000Z"),
    }],
    constraints: { maximumBudgetCents: 10000, scheduledAt: new Date("2026-06-26T12:00:00.000Z") },
    now: NOW,
    ...patch,
  };
}

describe("Slice 49 vendor-option eligibility", () => {
  it("allows a fully supported option for internal review only", () => {
    const result = evaluateVendorOptionEligibility(input());
    expect(result.eligibility_status).toBe("eligible_for_internal_review");
    expect(result.selected_evidence_id).toBe("evidence-1");
    expect(result.selected_terms_id).toBe("terms-1");
    expect(result.truth_flags).toEqual({
      available_not_booked: true, not_provider_accepted: true, not_paid: true,
      not_dispatched: true, not_completed: true, vendor_contacted: false,
      price_confirmed_by_terms: true, resident_proposal_allowed: false,
    });
  });

  it("fails closed for incomplete job cards and category mismatches", () => {
    const incomplete = buildRequestJobCard({ serviceIntent: "dog_grooming", rawRequest: "Dog groom",
      facts: {}, source: { sourceType: "manual" }, now: NOW });
    expect(evaluateVendorOptionEligibility(input({ jobCard: incomplete })).eligibility_status).toBe("needs_operator_review");
    expect(evaluateVendorOptionEligibility(input({ candidate: { ...input().candidate, serviceCategory: "handyman" } })).eligibility_status).toBe("outside_scope");
  });

  it("routes unapproved source or candidate to operator review", () => {
    expect(evaluateVendorOptionEligibility(input({ candidate: { ...input().candidate, sourceApproved: false } })).readiness_reasons[0].code)
      .toBe("candidate_source_not_approved");
    expect(evaluateVendorOptionEligibility(input({ candidate: { ...input().candidate, sourceStatus: "discovered" } })).eligibility_status)
      .toBe("needs_operator_review");
  });

  it("distinguishes missing terms from resident proposal eligibility", () => {
    const result = evaluateVendorOptionEligibility(input({ terms: [] }));
    expect(result.eligibility_status).toBe("missing_terms");
    expect(result.truth_flags.available_not_booked).toBe(false);
    expect(result.truth_flags.resident_proposal_allowed).toBe(false);
  });

  it("rejects budget and timing conflicts without guessing", () => {
    const overBudget = input();
    overBudget.constraints = { ...overBudget.constraints, maximumBudgetCents: 5000 };
    expect(evaluateVendorOptionEligibility(overBudget).readiness_reasons.map(item => item.code)).toContain("budget_conflict");
    const wrongTime = input();
    wrongTime.constraints = { ...wrongTime.constraints, scheduledAt: new Date("2026-06-27T12:00:00.000Z") };
    expect(evaluateVendorOptionEligibility(wrongTime).readiness_reasons.map(item => item.code)).toContain("timing_conflict");
  });

  it("routes expired, unapproved, low-confidence, and protected evidence safely", () => {
    const expired = input();
    expired.candidate = { ...expired.candidate, evidenceRows: expired.candidate.evidenceRows.map(row => ({ ...row, expiresAt: new Date("2026-06-21T12:00:00.000Z") })) };
    expect(evaluateVendorOptionEligibility(expired).eligibility_status).toBe("expired_or_stale_evidence");

    const low = input();
    low.candidate = { ...low.candidate, evidenceRows: low.candidate.evidenceRows.map(row => ({ ...row, sourceConfidence: "low" as const })) };
    expect(evaluateVendorOptionEligibility(low).eligibility_status).toBe("needs_operator_review");

    const blocked = input();
    blocked.candidate = { ...blocked.candidate, evidenceRows: blocked.candidate.evidenceRows.map(row => ({ ...row, evidencePayload: { race: "forbidden" } })) };
    expect(evaluateVendorOptionEligibility(blocked).eligibility_status).toBe("unsafe_to_present");
  });

  it("never infers contact, availability, or price without real evidence", () => {
    const missingAvailability = input();
    missingAvailability.terms = [{ ...missingAvailability.terms[0], availabilityStatus: "unknown", availabilityWindowsJson: [] }];
    const result = evaluateVendorOptionEligibility(missingAvailability);
    expect(result.truth_flags.available_not_booked).toBe(false);
    expect(result.truth_flags.price_confirmed_by_terms).toBe(false);
    expect(result.truth_flags.vendor_contacted).toBe(false);
  });

  it("routes low-confidence terms through the existing approval gate", () => {
    const lowConfidence = input();
    lowConfidence.terms = [{ ...lowConfidence.terms[0], confidence: "low" }];
    const result = evaluateVendorOptionEligibility(lowConfidence);
    expect(result.eligibility_status).toBe("needs_operator_review");
    expect(result.approval_gate?.status).toBe("proposal_requires_operator_review");
  });

  it("refuses this pre-proposal view when acceptance or booking truth already exists", () => {
    const result = evaluateVendorOptionEligibility(input({ providerAcceptance: {
      acceptanceType: "provider_accepted", acceptanceStatus: "accepted", expiresAt: null,
      serviceWindowStart: null, serviceWindowEnd: null, acceptedPriceCents: 8500,
    } }));
    expect(result.eligibility_status).toBe("unsafe_to_present");
    expect(result.readiness_reasons[0].code).toBe("existing_provider_truth_present");
  });

  it("is pure and contains no integration, storage, dog-fit, or outcome behavior", () => {
    const source = readFileSync("server/procurement/vendorOptionEligibilityPolicy.ts", "utf8");
    expect(source).not.toMatch(/INSERT|UPDATE|DELETE|fetch\(|axios|stripe|sendSMS|sendEmail/i);
    expect(source).not.toMatch(/dog.?fit|fit_sentence|fit_status/i);
    expect(source).toContain("state_mutated: false");
    expect(source).toContain("resident_proposal_allowed: false");
  });
});
