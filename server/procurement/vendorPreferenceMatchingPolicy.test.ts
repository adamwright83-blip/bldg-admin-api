import { describe, expect, it } from "vitest";
import {
  matchVendorPreferences,
  type VendorMatchCandidate,
  type VendorMatchPreferences,
} from "./vendorPreferenceMatchingPolicy";

const NOW = "2026-06-19T12:00:00.000Z";
const candidate = (id: string, patch: Partial<VendorMatchCandidate> = {}): VendorMatchCandidate => ({
  candidateId: id, rating: 4.7, reviewCount: 100, distanceKm: 3, servesRequestedArea: true,
  estimatedPriceCents: 10_000, reliabilityScore: 0.9,
  evidence: { sourceKey: "approved_directory", sourceApproved: true, sourceConfidence: 0.95,
    observedAt: "2026-06-01T00:00:00.000Z", expiresAt: "2026-07-01T00:00:00.000Z" },
  ...patch,
});
const preferences = (patch: Partial<VendorMatchPreferences> = {}): VendorMatchPreferences => ({
  minimumRating: 4.3, minimumReviewCount: 20, requireServiceArea: true, minimumSourceConfidence: 0.9,
  ...patch,
});

describe("vendor preference matching policy", () => {
  it("rejects 4.6 when the hard rating threshold is 4.7", () => {
    const result = matchVendorPreferences({ candidates: [candidate("a", { rating: 4.6 })],
      preferences: preferences({ minimumRating: 4.7 }), evaluatedAt: NOW });
    expect(result.status).toBe("no_match");
    expect(result.decisions[0].reasons).toContain("minimum_rating_not_met");
  });

  it("accepts 4.3 only with valid trusted source confidence", () => {
    expect(matchVendorPreferences({ candidates: [candidate("a", { rating: 4.3 })],
      preferences: preferences(), evaluatedAt: NOW }).selectedCandidateId).toBe("a");
    const untrusted = candidate("b", { rating: 4.3, evidence: { sourceKey: "unknown", sourceApproved: false,
      sourceConfidence: 1, observedAt: "2026-06-01T00:00:00.000Z", expiresAt: "2026-07-01T00:00:00.000Z" } });
    expect(matchVendorPreferences({ candidates: [untrusted], preferences: preferences(), evaluatedAt: NOW }).status)
      .toBe("needs_review");
  });

  it("fails closed for stale, missing, and low-confidence evidence", () => {
    const stale = candidate("stale", { evidence: { sourceKey: "approved", sourceApproved: true,
      sourceConfidence: 1, observedAt: "2025-01-01T00:00:00.000Z", expiresAt: "2025-02-01T00:00:00.000Z" } });
    const missing = candidate("missing", { evidence: null });
    const weak = candidate("weak", { evidence: { sourceKey: "approved", sourceApproved: true,
      sourceConfidence: 0.5, observedAt: "2026-06-01T00:00:00.000Z", expiresAt: "2026-07-01T00:00:00.000Z" } });
    const result = matchVendorPreferences({ candidates: [stale, missing, weak], preferences: preferences(), evaluatedAt: NOW });
    expect(result.status).toBe("needs_review");
    expect(result.decisions.every(decision => decision.status === "needs_review")).toBe(true);
  });

  it("chooses the cheapest acceptable candidate without overriding hard quality", () => {
    const result = matchVendorPreferences({ candidates: [candidate("cheap-bad", { rating: 4.2, estimatedPriceCents: 100 }),
      candidate("acceptable", { rating: 4.3, estimatedPriceCents: 5_000 }),
      candidate("expensive", { estimatedPriceCents: 15_000 })],
      preferences: preferences({ pricePreference: "cheapest_acceptable" }), evaluatedAt: NOW });
    expect(result.selectedCandidateId).toBe("acceptable");
    expect(result.decisions.find(decision => decision.candidateId === "cheap-bad")?.status).toBe("rejected");
  });

  it("chooses the highest-rated candidate under budget", () => {
    const result = matchVendorPreferences({ candidates: [candidate("over", { rating: 5, estimatedPriceCents: 20_000 }),
      candidate("best", { rating: 4.8, estimatedPriceCents: 9_000 }), candidate("lower", { rating: 4.5, estimatedPriceCents: 8_000 })],
      preferences: preferences({ maximumBudgetCents: 10_000, pricePreference: "highest_rated_under_budget" }), evaluatedAt: NOW });
    expect(result.selectedCandidateId).toBe("best");
  });

  it("enforces review count, distance, service area, and reliability requirements", () => {
    const result = matchVendorPreferences({ candidates: [candidate("a", { reviewCount: 2, distanceKm: 20,
      servesRequestedArea: false, reliabilityScore: 0.4 })], preferences: preferences({ minimumReviewCount: 10,
      maximumDistanceKm: 5, reliabilityPreference: "require_minimum", minimumReliabilityScore: 0.8 }), evaluatedAt: NOW });
    expect(result.decisions[0].reasons).toEqual(expect.arrayContaining([
      "minimum_review_count_not_met", "maximum_distance_exceeded", "outside_service_area", "minimum_reliability_not_met",
    ]));
  });

  it("rejects protected-class and proxy fields instead of using them", () => {
    const unsafePreferences = { ...preferences(), race: "any" } as VendorMatchPreferences;
    const result = matchVendorPreferences({ candidates: [candidate("a")], preferences: unsafePreferences, evaluatedAt: NOW });
    expect(result.status).toBe("invalid_input");
    expect(result.reasons[0]).toContain("protected_or_proxy_field");
    const proxyCandidate = { ...candidate("b"), zip_code: "90210" } as VendorMatchCandidate;
    expect(matchVendorPreferences({ candidates: [proxyCandidate], preferences: preferences(), evaluatedAt: NOW }).status)
      .toBe("invalid_input");
  });

  it("is deterministic and performs no external work", () => {
    const input = { candidates: [candidate("b"), candidate("a")], preferences: preferences(), evaluatedAt: NOW };
    expect(matchVendorPreferences(input)).toEqual(matchVendorPreferences(input));
    expect(matchVendorPreferences(input).selectedCandidateId).toBe("a");
  });
});
