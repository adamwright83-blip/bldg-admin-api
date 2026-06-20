import { describe, expect, it, vi } from "vitest";
import {
  evaluateVendorMatchEvaluation,
  evaluateVendorMatchEvaluationCandidate,
  type VendorMatchEvaluationCandidateInput,
} from "./vendorMatchEvaluationPolicy";
import type { VendorReputationEvidenceRow } from "./vendorEvidenceResolverPolicy";
import type { VendorMatchPreferences } from "./vendorPreferenceMatchingPolicy";

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

function candidate(id: string, patch: Partial<VendorMatchEvaluationCandidateInput> = {}): VendorMatchEvaluationCandidateInput {
  return {
    candidateId: id, rating: 4.7, reviewCount: 100, distanceKm: 3, servesRequestedArea: true,
    estimatedPriceCents: 10_000, reliabilityScore: 0.9,
    evidenceRows: [row({ id: `${id}-evidence`, candidateId: id })],
    ...patch,
  };
}

const preferences: VendorMatchPreferences = { minimumRating: 4.3, minimumReviewCount: 20, minimumSourceConfidence: 0.9 };

describe("evaluateVendorMatchEvaluationCandidate", () => {
  it("fails closed to needs_review when no evidence rows exist", () => {
    const decision = evaluateVendorMatchEvaluationCandidate(
      candidate("candidate-1", { evidenceRows: [] }), preferences, NOW);
    expect(decision.matchStatus).toBe("needs_review");
    expect(decision.decisionReasons).toContain("no_evidence_rows");
    expect(decision.rankOrder).toBeNull();
  });

  it("fails closed to needs_review for expired evidence", () => {
    const decision = evaluateVendorMatchEvaluationCandidate(
      candidate("candidate-1", {
        evidenceRows: [row({ id: "candidate-1-evidence", candidateId: "candidate-1",
          expiresAt: new Date("2026-06-10T00:00:00.000Z") })],
      }), preferences, NOW);
    expect(decision.matchStatus).toBe("needs_review");
  });

  it("fails closed to blocked for untrusted source confidence", () => {
    const decision = evaluateVendorMatchEvaluationCandidate(
      candidate("candidate-1", {
        evidenceRows: [row({ id: "candidate-1-evidence", candidateId: "candidate-1", sourceConfidence: "untrusted" })],
      }), preferences, NOW);
    expect(decision.matchStatus).toBe("blocked");
    expect(decision.riskFlags).toContain("source_confidence_untrusted");
  });

  it("fails closed to blocked for quarantined evidence status", () => {
    const decision = evaluateVendorMatchEvaluationCandidate(
      candidate("candidate-1", {
        evidenceRows: [row({ id: "candidate-1-evidence", candidateId: "candidate-1", evidenceStatus: "quarantined" })],
      }), preferences, NOW);
    expect(decision.matchStatus).toBe("blocked");
  });

  it("fails closed to blocked for rejected evidence status", () => {
    const decision = evaluateVendorMatchEvaluationCandidate(
      candidate("candidate-1", {
        evidenceRows: [row({ id: "candidate-1-evidence", candidateId: "candidate-1", evidenceStatus: "rejected" })],
      }), preferences, NOW);
    expect(decision.matchStatus).toBe("blocked");
  });

  it("blocks Reddit evidence without a valid legal approval artifact", () => {
    const decision = evaluateVendorMatchEvaluationCandidate(
      candidate("candidate-1", {
        evidenceRows: [row({ id: "candidate-1-evidence", candidateId: "candidate-1", sourceKey: "reddit" })],
      }), preferences, NOW);
    expect(decision.matchStatus).toBe("blocked");
    expect(decision.riskFlags).toContain("reddit_without_legal_approval");
  });

  it("allows Reddit evidence with a valid legal approval artifact to proceed to matching", () => {
    const decision = evaluateVendorMatchEvaluationCandidate(
      candidate("candidate-1", {
        evidenceRows: [row({
          id: "candidate-1-evidence", candidateId: "candidate-1", sourceKey: "reddit",
          complianceSnapshot: {
            legalApprovalArtifact: {
              artifactId: "legal-review-123", approvedBy: "legal-operator", scope: "candidate_evidence",
              approvedAt: new Date("2026-06-01T00:00:00.000Z"),
            },
          },
        })],
      }), preferences, NOW);
    expect(decision.matchStatus).toBe("matched");
  });

  it("rejects protected or proxy fields in the evidence payload as blocked", () => {
    const decision = evaluateVendorMatchEvaluationCandidate(
      candidate("candidate-1", {
        evidenceRows: [row({ id: "candidate-1-evidence", candidateId: "candidate-1",
          evidencePayload: { zip_code: "90210" } })],
      }), preferences, NOW);
    expect(decision.matchStatus).toBe("blocked");
    expect(decision.riskFlags).toContain("protected_or_proxy_field");
  });

  it("rejects protected or proxy fields on the candidate input itself as blocked", () => {
    const decision = evaluateVendorMatchEvaluationCandidate(
      candidate("candidate-1", { ...({ zip_code: "90210" } as Record<string, unknown>) }) as VendorMatchEvaluationCandidateInput,
      preferences, NOW);
    expect(decision.matchStatus).toBe("blocked");
  });

  it("produces a matched evaluation only -- never an execution, booking, or contact field -- for valid usable evidence", () => {
    const decision = evaluateVendorMatchEvaluationCandidate(candidate("candidate-1"), preferences, NOW);
    expect(decision.matchStatus).toBe("matched");
    expect(decision).not.toHaveProperty("booked");
    expect(decision).not.toHaveProperty("contacted");
    expect(decision).not.toHaveProperty("dispatched");
    expect(decision).not.toHaveProperty("paid");
    expect(decision.score).toBe(94);
  });

  it("marks a candidate not_matched when it fails a preference threshold with usable evidence", () => {
    const decision = evaluateVendorMatchEvaluationCandidate(
      candidate("candidate-1", { rating: 3.5 }), preferences, NOW);
    expect(decision.matchStatus).toBe("not_matched");
    expect(decision.decisionReasons).toContain("minimum_rating_not_met");
  });
});

describe("evaluateVendorMatchEvaluation", () => {
  it("blocks the whole run for protected or proxy fields in the request context", () => {
    const result = evaluateVendorMatchEvaluation({
      requestContext: { zip_code: "90210" }, candidates: [candidate("candidate-1")], preferences, now: NOW,
    });
    expect(result.evaluationStatus).toBe("blocked");
    expect(result.decisions).toEqual([]);
  });

  it("ranks only matched candidates, deterministically, by score/rating/reviewCount/id", () => {
    const candidates = [
      candidate("low", { rating: 4.4, reviewCount: 30 }),
      candidate("high", { rating: 4.9, reviewCount: 200 }),
      candidate("mid", { rating: 4.6, reviewCount: 100 }),
    ];
    const result = evaluateVendorMatchEvaluation({ requestContext: {}, candidates, preferences, now: NOW });
    const matched = result.decisions.filter(decision => decision.matchStatus === "matched")
      .sort((a, b) => (a.rankOrder ?? 0) - (b.rankOrder ?? 0));
    expect(matched.map(decision => decision.candidateId)).toEqual(["high", "mid", "low"]);
    expect(matched.map(decision => decision.rankOrder)).toEqual([1, 2, 3]);

    const reversedResult = evaluateVendorMatchEvaluation({
      requestContext: {}, candidates: candidates.slice().reverse(), preferences, now: NOW,
    });
    const reversedMatched = reversedResult.decisions.filter(decision => decision.matchStatus === "matched")
      .sort((a, b) => (a.rankOrder ?? 0) - (b.rankOrder ?? 0));
    expect(reversedMatched.map(decision => decision.candidateId)).toEqual(["high", "mid", "low"]);
  });

  it("does not assign rank_order to non-matched candidates", () => {
    const result = evaluateVendorMatchEvaluation({
      requestContext: {},
      candidates: [candidate("matched-one"), candidate("blocked-one", { evidenceRows: [] })],
      preferences, now: NOW,
    });
    const blocked = result.decisions.find(decision => decision.candidateId === "blocked-one");
    expect(blocked?.rankOrder).toBeNull();
  });

  it("reports needs_operator_review when no candidate matches but some need review", () => {
    const result = evaluateVendorMatchEvaluation({
      requestContext: {}, candidates: [candidate("candidate-1", { evidenceRows: [] })], preferences, now: NOW,
    });
    expect(result.evaluationStatus).toBe("needs_operator_review");
  });

  it("is deterministic and performs no external work", () => {
    const externalCall = vi.fn();
    vi.stubGlobal("fetch", externalCall);
    const input = { requestContext: {}, candidates: [candidate("candidate-1")], preferences, now: NOW };
    expect(evaluateVendorMatchEvaluation(input)).toEqual(evaluateVendorMatchEvaluation(input));
    expect(externalCall).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
