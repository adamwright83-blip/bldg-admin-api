import { describe, expect, it, vi } from "vitest";
import {
  resolveCandidateEvidence,
  resolveVendorPreferenceMatch,
  type VendorReputationEvidenceRow,
} from "./vendorEvidenceResolverPolicy";

const NOW = new Date("2026-06-19T12:00:00.000Z");

function row(patch: Partial<VendorReputationEvidenceRow> = {}): VendorReputationEvidenceRow {
  return {
    id: "evidence-1",
    candidateId: "candidate-1",
    sourceType: "public_business_directory",
    sourceKey: "google_business_profiles",
    evidenceStatus: "usable",
    rating: 4.7,
    ratingScaleMin: 0,
    ratingScaleMax: 5,
    reviewCount: 120,
    sourceConfidence: "trusted",
    sourceApproved: true,
    observedAt: new Date("2026-06-01T00:00:00.000Z"),
    expiresAt: new Date("2026-07-01T00:00:00.000Z"),
    evidencePayload: { businessName: "Acme Dog Grooming" },
    complianceSnapshot: {},
    ...patch,
  };
}

describe("resolveCandidateEvidence", () => {
  it("fails closed when there are no evidence rows", () => {
    expect(resolveCandidateEvidence("candidate-1", [], NOW)).toEqual({
      candidateId: "candidate-1", snapshot: null, selectedEvidenceId: null, reasons: ["no_usable_evidence"],
    });
  });

  it("fails closed for expired evidence", () => {
    const result = resolveCandidateEvidence("candidate-1",
      [row({ expiresAt: new Date("2026-06-10T00:00:00.000Z") })], NOW);
    expect(result.snapshot).toBeNull();
  });

  it("fails closed for quarantined or rejected evidence", () => {
    expect(resolveCandidateEvidence("candidate-1", [row({ evidenceStatus: "quarantined" })], NOW).snapshot).toBeNull();
    expect(resolveCandidateEvidence("candidate-1", [row({ evidenceStatus: "rejected" })], NOW).snapshot).toBeNull();
  });

  it("fails closed when source_approved is false", () => {
    expect(resolveCandidateEvidence("candidate-1", [row({ sourceApproved: false })], NOW).snapshot).toBeNull();
  });

  it("fails closed for untrusted source confidence", () => {
    expect(resolveCandidateEvidence("candidate-1", [row({ sourceConfidence: "untrusted" })], NOW).snapshot).toBeNull();
  });

  it("fails closed for protected or proxy fields in the evidence payload", () => {
    expect(resolveCandidateEvidence("candidate-1",
      [row({ evidencePayload: { zip_code: "90210" } })], NOW).snapshot).toBeNull();
  });

  it("fails closed for Reddit evidence without a valid legal approval artifact", () => {
    expect(resolveCandidateEvidence("candidate-1", [row({ sourceKey: "reddit" })], NOW).snapshot).toBeNull();
    const withApproval = resolveCandidateEvidence("candidate-1", [row({
      sourceKey: "reddit",
      complianceSnapshot: {
        legalApprovalArtifact: {
          artifactId: "legal-review-123", approvedBy: "legal-operator", scope: "candidate_evidence",
          approvedAt: new Date("2026-06-01T00:00:00.000Z"),
        },
      },
    })], NOW);
    expect(withApproval.snapshot).not.toBeNull();
  });

  it("converts valid trusted fresh approved evidence into a VendorEvidenceSnapshot", () => {
    const result = resolveCandidateEvidence("candidate-1", [row()], NOW);
    expect(result.snapshot).toEqual({
      sourceKey: "google_business_profiles", sourceApproved: true, sourceConfidence: 1,
      observedAt: "2026-06-01T00:00:00.000Z", expiresAt: "2026-07-01T00:00:00.000Z",
    });
    expect(result.selectedEvidenceId).toBe("evidence-1");
  });

  it("deterministically tie-breaks across multiple usable evidence rows regardless of input order", () => {
    const rows = [
      row({ id: "z-row", sourceConfidence: "medium", observedAt: new Date("2026-06-15T00:00:00.000Z") }),
      row({ id: "a-row", sourceConfidence: "trusted", observedAt: new Date("2026-06-01T00:00:00.000Z") }),
      row({ id: "b-row", sourceConfidence: "trusted", observedAt: new Date("2026-06-10T00:00:00.000Z") }),
    ];
    expect(resolveCandidateEvidence("candidate-1", rows, NOW).selectedEvidenceId).toBe("b-row");
    expect(resolveCandidateEvidence("candidate-1", rows.slice().reverse(), NOW).selectedEvidenceId).toBe("b-row");
  });
});

describe("resolveVendorPreferenceMatch", () => {
  const preferences = { minimumRating: 4.3, minimumReviewCount: 20, minimumSourceConfidence: 0.9 };
  const baseCandidate = (id: string, patch: Record<string, unknown> = {}) => ({
    candidateId: id, rating: 4.7, reviewCount: 100, distanceKm: 3, servesRequestedArea: true,
    estimatedPriceCents: 10_000, reliabilityScore: 0.9, evidenceRows: [row({ id: `${id}-evidence`, candidateId: id })],
    ...patch,
  });

  it("fails closed for missing evidence rows", () => {
    const result = resolveVendorPreferenceMatch({
      candidates: [{ ...baseCandidate("candidate-1"), evidenceRows: [] }],
      preferences, now: NOW,
    });
    expect(result.status).toBe("needs_review");
    expect(result.evidenceResolutions[0]).toEqual({
      candidateId: "candidate-1", snapshot: null, selectedEvidenceId: null, reasons: ["no_usable_evidence"],
    });
  });

  it("matches a candidate backed by valid usable evidence", () => {
    const result = resolveVendorPreferenceMatch({ candidates: [baseCandidate("candidate-1")], preferences, now: NOW });
    expect(result.selectedCandidateId).toBe("candidate-1");
  });

  it("rejects 4.6 against a 4.7 hard rating threshold even with trusted evidence", () => {
    const result = resolveVendorPreferenceMatch({
      candidates: [baseCandidate("candidate-1", { rating: 4.6 })],
      preferences: { ...preferences, minimumRating: 4.7 }, now: NOW,
    });
    expect(result.status).toBe("no_match");
    expect(result.decisions[0].reasons).toContain("minimum_rating_not_met");
  });

  it("chooses the cheapest acceptable candidate without overriding the hard quality threshold", () => {
    const result = resolveVendorPreferenceMatch({
      candidates: [
        baseCandidate("cheap-bad", { rating: 4.2, estimatedPriceCents: 100 }),
        baseCandidate("acceptable", { rating: 4.3, estimatedPriceCents: 5_000 }),
      ],
      preferences: { ...preferences, pricePreference: "cheapest_acceptable" as const }, now: NOW,
    });
    expect(result.selectedCandidateId).toBe("acceptable");
  });

  it("chooses the highest-rated candidate that still honors the budget", () => {
    const result = resolveVendorPreferenceMatch({
      candidates: [
        baseCandidate("over", { rating: 5, estimatedPriceCents: 20_000 }),
        baseCandidate("best", { rating: 4.8, estimatedPriceCents: 9_000 }),
      ],
      preferences: { ...preferences, maximumBudgetCents: 10_000, pricePreference: "highest_rated_under_budget" as const },
      now: NOW,
    });
    expect(result.selectedCandidateId).toBe("best");
  });

  it("is deterministic and performs no external work", () => {
    const externalCall = vi.fn();
    vi.stubGlobal("fetch", externalCall);
    const input = { candidates: [baseCandidate("candidate-1")], preferences, now: NOW };
    expect(resolveVendorPreferenceMatch(input)).toEqual(resolveVendorPreferenceMatch(input));
    expect(externalCall).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
