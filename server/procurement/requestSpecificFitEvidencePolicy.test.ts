import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildRequestJobCard } from "./requestJobCardPolicy";
import { evaluateRequestSpecificFitEvidence, type RequestSpecificFitInput } from "./requestSpecificFitEvidencePolicy";
import type { VendorReputationEvidenceRow } from "./vendorEvidenceResolverPolicy";

const NOW = new Date("2026-06-22T12:00:00.000Z");

function evidence(patch: Partial<VendorReputationEvidenceRow> = {}): VendorReputationEvidenceRow {
  return {
    id: "evidence-1", candidateId: "candidate-1", sourceType: "public_business_directory",
    sourceKey: "google_business_profiles", evidenceStatus: "usable", rating: 4.8,
    ratingScaleMin: 0, ratingScaleMax: 5, reviewCount: 120, sourceConfidence: "trusted",
    sourceApproved: true, observedAt: new Date("2026-06-20T00:00:00.000Z"),
    expiresAt: new Date("2026-07-20T00:00:00.000Z"), evidencePayload: {}, complianceSnapshot: {},
    ...patch,
  };
}

function input(
  dog: Record<string, unknown> = { name: "Theo", breed: "Poodle", size: "medium", temperament: "anxious" },
  rows: VendorReputationEvidenceRow[] = [evidence({ evidencePayload: { requestFitEvidence: { breeds: ["Poodle"] } } })],
): RequestSpecificFitInput {
  return {
    jobCard: buildRequestJobCard({ serviceIntent: "dog_grooming", rawRequest: "Groom Theo Friday",
      residentContext: { buildingSlug: "the-wright" }, facts: { buildingSlug: "the-wright", requestedDate: "2026-06-26", dog },
      source: { sourceType: "service_request", sourceId: "1" }, now: NOW }),
    vendorOption: { eligibility_status: "eligible_for_internal_review", candidate_id: "candidate-1",
      selected_evidence_id: "evidence-1", truth_flags: { available_not_booked: true, not_provider_accepted: true,
        not_paid: true, not_dispatched: true, not_completed: true, vendor_contacted: false,
        price_confirmed_by_terms: true, resident_proposal_allowed: false } },
    evidenceRows: rows, now: NOW,
  };
}

describe("request-specific fit evidence policy", () => {
  it("returns a deterministic strong match for exact breed evidence", () => {
    const result = evaluateRequestSpecificFitEvidence(input());
    expect(result.fit_status).toBe("strong_match");
    expect(result.fit_basis.matched_fields).toEqual(["breed"]);
    expect(result.fit_basis.evidence_ids).toEqual(["evidence-1"]);
    expect(result.fit_basis.display_sentence).toBe("I found explicit relevant evidence for poodle, which fits Theo’s request.");
    expect(evaluateRequestSpecificFitEvidence(input())).toEqual(result);
  });

  it("supports compatible size, temperament, and handling matches", () => {
    const size = evaluateRequestSpecificFitEvidence(input({ name: "Theo", size: "medium" },
      [evidence({ evidencePayload: { requestFitEvidence: { sizes: ["small-medium"] } } })]));
    expect(size.fit_status).toBe("partial_match");
    expect(size.fit_basis.matched_fields).toEqual(["size"]);

    const multi = evaluateRequestSpecificFitEvidence(input(
      { name: "Theo", temperament: "anxious", handlingNotes: "calm handling" },
      [evidence({ evidencePayload: { requestFitEvidence: {
        temperaments: ["anxious"], handlingStyles: ["calm handling"],
      } } })],
    ));
    expect(multi.fit_status).toBe("strong_match");
    expect(multi.fit_basis.matched_fields).toEqual(["temperament", "handling_needs"]);
  });

  it("falls back to general reputation without padding specificity", () => {
    const result = evaluateRequestSpecificFitEvidence(input(
      { name: "Theo", size: "medium" },
      [evidence({ evidencePayload: { generalGroomingReputation: true } })],
    ));
    expect(result.fit_status).toBe("general_reputation_only");
    expect(result.fit_basis.matched_fields).toEqual([]);
    expect(result.fit_basis.display_sentence).toContain("no specific evidence");
  });

  it("does not treat small-dog evidence as a match for a large dog", () => {
    const result = evaluateRequestSpecificFitEvidence(input(
      { name: "Theo", size: "large" },
      [evidence({ evidencePayload: { requestFitEvidence: { sizes: ["small"] } } })],
    ));
    expect(result.fit_status).toBe("mismatch_or_unknown");
    expect(result.fit_basis.safe_to_display).toBe(true);
    expect(result.fit_basis.display_sentence).toContain("other dog sizes");
  });

  it("honors explicit request-scoped negative constraints", () => {
    const result = evaluateRequestSpecificFitEvidence(input(
      { name: "Theo", size: "medium", negativeConstraints: ["no cages"] },
      [evidence({ evidencePayload: { requestFitEvidence: { negativeConstraints: ["no cages"] } } })],
    ));
    expect(result.fit_status).toBe("mismatch_or_unknown");
    expect(result.fit_basis.reason_codes).toContain("explicit_fit_mismatch");
  });

  it("handles missing dog facts as general reputation only", () => {
    const result = evaluateRequestSpecificFitEvidence(input({},
      [evidence({ evidencePayload: { generalGroomingReputation: true } })]));
    expect(result.fit_status).toBe("general_reputation_only");
    expect(result.fit_basis.reason_codes).toContain("request_dog_facts_missing");
  });

  it("uses the fixed unknown sentence when usable evidence has no relevant fit claim", () => {
    const result = evaluateRequestSpecificFitEvidence(input(
      { name: "Theo", breed: "Poodle" },
      [evidence({ rating: null, reviewCount: null, evidencePayload: { businessName: "Safe Groomer" } })],
    ));
    expect(result.fit_status).toBe("mismatch_or_unknown");
    expect(result.fit_basis.safe_to_display).toBe(true);
    expect(result.fit_basis.display_sentence).toBe("I did not find enough specific evidence to make a dog-fit claim.");
  });

  it.each([
    ["no evidence", []],
    ["expired", [evidence({ expiresAt: new Date("2026-06-21T00:00:00.000Z") })]],
    ["unapproved", [evidence({ sourceApproved: false })]],
    ["low confidence", [evidence({ sourceConfidence: "low" })]],
  ] as const)("fails closed for %s", (_label, rows) => {
    const result = evaluateRequestSpecificFitEvidence(input(undefined, [...rows]));
    expect(result.fit_status).toBe("unsafe_to_display");
    expect(result.fit_basis.safe_to_display).toBe(false);
    expect(result.fit_basis.display_sentence).toBeNull();
  });

  it("suppresses unsafe free-form claims and includes only evidence IDs internally", () => {
    const result = evaluateRequestSpecificFitEvidence(input(
      { name: "Theo", breed: "Poodle" },
      [evidence({ id: "safe-id", evidencePayload: { requestFitEvidence: { breeds: ["Poodle"],
        claimText: "Guaranteed perfect outcome, booked Friday, five stars" } } })],
    ));
    expect(result.fit_basis.evidence_ids).toEqual(["safe-id"]);
    expect(result.fit_basis.display_sentence).not.toMatch(/guaranteed|booked|five stars/i);
  });

  it("blocks fit display when Slice 49 eligibility did not pass", () => {
    const value = input();
    value.vendorOption = { ...value.vendorOption, eligibility_status: "needs_operator_review" };
    expect(evaluateRequestSpecificFitEvidence(value).fit_status).toBe("unsafe_to_display");
  });

  it("contains no LLM, scraping, persistence, outreach, or execution behavior", () => {
    const source = readFileSync("server/procurement/requestSpecificFitEvidencePolicy.ts", "utf8");
    expect(source).not.toMatch(/INSERT|UPDATE|DELETE|fetch\(|axios|anthropic|openai|scrap|sendSMS|sendEmail/i);
    expect(source).toContain("llm_called: false");
    expect(source).toContain("state_mutated: false");
  });
});
