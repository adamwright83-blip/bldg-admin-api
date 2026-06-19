export type VendorEvidenceSnapshot = {
  sourceKey: string;
  sourceApproved: boolean;
  sourceConfidence: number;
  observedAt: string;
  expiresAt: string;
};

export type VendorMatchCandidate = {
  candidateId: string;
  rating: number | null;
  reviewCount: number | null;
  distanceKm: number | null;
  servesRequestedArea: boolean | null;
  estimatedPriceCents: number | null;
  reliabilityScore: number | null;
  evidence: VendorEvidenceSnapshot | null;
};

export type VendorMatchPreferences = {
  minimumRating: number;
  minimumReviewCount?: number;
  maximumDistanceKm?: number;
  requireServiceArea?: boolean;
  maximumBudgetCents?: number;
  pricePreference?: "none" | "cheapest_acceptable" | "highest_rated_under_budget";
  reliabilityPreference?: "none" | "prefer_reliable" | "require_minimum";
  minimumReliabilityScore?: number;
  minimumSourceConfidence?: number;
};

export type VendorMatchDecision = {
  candidateId: string;
  status: "eligible" | "needs_review" | "rejected";
  reasons: string[];
};

export type VendorMatchResult = {
  status: "matched" | "no_match" | "needs_review" | "invalid_input";
  selectedCandidateId: string | null;
  decisions: VendorMatchDecision[];
  reasons: string[];
};

const PROTECTED_OR_PROXY_KEYS = new Set([
  "race", "ethnicity", "color", "religion", "sex", "gender", "sexualorientation",
  "genderidentity", "pregnancy", "nationalorigin", "nationality", "citizenship",
  "age", "disability", "geneticinformation", "maritalstatus", "familystatus",
  "veteranstatus", "surname", "lastname", "language", "zipcode", "postalcode",
  "neighborhood", "census tract", "censustract",
]);

function normalizedKey(key: string) {
  return key.toLowerCase().replace(/[_\-\s]/g, "");
}

export function findProtectedOrProxyFields(value: unknown, path = "input"): string[] {
  if (value === null || typeof value !== "object") return [];
  const found: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (PROTECTED_OR_PROXY_KEYS.has(normalizedKey(key))) found.push(childPath);
    found.push(...findProtectedOrProxyFields(child, childPath));
  }
  return found;
}

function finiteAtLeast(value: number, minimum: number) {
  return Number.isFinite(value) && value >= minimum;
}

export function evaluateVendorPreferenceCandidate(
  candidate: VendorMatchCandidate,
  preferences: VendorMatchPreferences,
  evaluatedAt: string,
): VendorMatchDecision {
  const reasons: string[] = [];
  const protectedFields = findProtectedOrProxyFields({ candidate, preferences });
  if (protectedFields.length) {
    return { candidateId: candidate.candidateId, status: "rejected",
      reasons: protectedFields.map(field => `protected_or_proxy_field:${field}`) };
  }

  if (candidate.rating === null || candidate.reviewCount === null || candidate.evidence === null) {
    return { candidateId: candidate.candidateId, status: "needs_review",
      reasons: ["rating_evidence_missing"] };
  }
  if (!candidate.evidence.sourceApproved) {
    return { candidateId: candidate.candidateId, status: "needs_review",
      reasons: ["rating_source_not_approved"] };
  }
  if (!finiteAtLeast(candidate.evidence.sourceConfidence, preferences.minimumSourceConfidence ?? 0.8)) {
    return { candidateId: candidate.candidateId, status: "needs_review",
      reasons: ["source_confidence_below_threshold"] };
  }
  const evaluatedMs = Date.parse(evaluatedAt);
  const observedMs = Date.parse(candidate.evidence.observedAt);
  const expiresMs = Date.parse(candidate.evidence.expiresAt);
  if (![evaluatedMs, observedMs, expiresMs].every(Number.isFinite)
      || observedMs > evaluatedMs || expiresMs < evaluatedMs) {
    return { candidateId: candidate.candidateId, status: "needs_review",
      reasons: ["rating_evidence_stale_or_invalid"] };
  }

  if (!finiteAtLeast(candidate.rating, 0) || candidate.rating > 5
      || !Number.isInteger(candidate.reviewCount) || candidate.reviewCount < 0) {
    return { candidateId: candidate.candidateId, status: "needs_review",
      reasons: ["rating_evidence_invalid"] };
  }
  if (candidate.rating < preferences.minimumRating) reasons.push("minimum_rating_not_met");
  if (candidate.reviewCount < (preferences.minimumReviewCount ?? 0)) reasons.push("minimum_review_count_not_met");
  if (preferences.maximumDistanceKm !== undefined
      && (candidate.distanceKm === null || candidate.distanceKm > preferences.maximumDistanceKm)) {
    reasons.push(candidate.distanceKm === null ? "distance_missing" : "maximum_distance_exceeded");
  }
  if (preferences.requireServiceArea && candidate.servesRequestedArea !== true) {
    reasons.push(candidate.servesRequestedArea === null ? "service_area_missing" : "outside_service_area");
  }
  if (preferences.maximumBudgetCents !== undefined
      && (candidate.estimatedPriceCents === null || candidate.estimatedPriceCents > preferences.maximumBudgetCents)) {
    reasons.push(candidate.estimatedPriceCents === null ? "price_evidence_missing" : "budget_exceeded");
  }
  if (preferences.reliabilityPreference === "require_minimum"
      && (candidate.reliabilityScore === null
        || candidate.reliabilityScore < (preferences.minimumReliabilityScore ?? 0.8))) {
    reasons.push(candidate.reliabilityScore === null ? "reliability_evidence_missing" : "minimum_reliability_not_met");
  }
  return { candidateId: candidate.candidateId, status: reasons.length ? "rejected" : "eligible", reasons };
}

export function matchVendorPreferences(input: {
  candidates: VendorMatchCandidate[];
  preferences: VendorMatchPreferences;
  evaluatedAt: string;
}): VendorMatchResult {
  const invalidFields = findProtectedOrProxyFields(input);
  if (invalidFields.length) return { status: "invalid_input", selectedCandidateId: null, decisions: [],
    reasons: invalidFields.map(field => `protected_or_proxy_field:${field}`) };
  if (!finiteAtLeast(input.preferences.minimumRating, 0) || input.preferences.minimumRating > 5) {
    return { status: "invalid_input", selectedCandidateId: null, decisions: [], reasons: ["minimum_rating_invalid"] };
  }
  const decisions = input.candidates.map(candidate =>
    evaluateVendorPreferenceCandidate(candidate, input.preferences, input.evaluatedAt));
  const eligible = input.candidates.filter(candidate =>
    decisions.find(decision => decision.candidateId === candidate.candidateId)?.status === "eligible");
  const preference = input.preferences.pricePreference ?? "none";
  eligible.sort((a, b) => {
    if (preference === "cheapest_acceptable") {
      return (a.estimatedPriceCents ?? Number.MAX_SAFE_INTEGER) - (b.estimatedPriceCents ?? Number.MAX_SAFE_INTEGER)
        || (b.rating ?? 0) - (a.rating ?? 0) || a.candidateId.localeCompare(b.candidateId);
    }
    if (preference === "highest_rated_under_budget") {
      return (b.rating ?? 0) - (a.rating ?? 0)
        || (a.estimatedPriceCents ?? Number.MAX_SAFE_INTEGER) - (b.estimatedPriceCents ?? Number.MAX_SAFE_INTEGER)
        || a.candidateId.localeCompare(b.candidateId);
    }
    if (input.preferences.reliabilityPreference === "prefer_reliable") {
      return (b.reliabilityScore ?? -1) - (a.reliabilityScore ?? -1)
        || (b.rating ?? 0) - (a.rating ?? 0) || a.candidateId.localeCompare(b.candidateId);
    }
    return (b.rating ?? 0) - (a.rating ?? 0) || a.candidateId.localeCompare(b.candidateId);
  });
  if (eligible[0]) return { status: "matched", selectedCandidateId: eligible[0].candidateId, decisions, reasons: [] };
  const needsReview = decisions.some(decision => decision.status === "needs_review");
  return { status: needsReview ? "needs_review" : "no_match", selectedCandidateId: null, decisions,
    reasons: [needsReview ? "candidate_evidence_needs_review" : "no_candidate_meets_requirements"] };
}
