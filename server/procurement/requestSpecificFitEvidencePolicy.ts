import type { RequestJobCard } from "./requestJobCardPolicy";
import {
  evaluateVendorReputationEvidence,
  type SourceConfidenceLevel,
} from "./vendorReputationEvidencePolicy";
import {
  resolveCandidateEvidence,
  type VendorReputationEvidenceRow,
} from "./vendorEvidenceResolverPolicy";
import type { VendorOptionEligibilityDecision } from "./vendorOptionEligibilityPolicy";

export const REQUEST_SPECIFIC_FIT_STATUSES = [
  "strong_match",
  "partial_match",
  "general_reputation_only",
  "mismatch_or_unknown",
  "unsafe_to_display",
] as const;

export type RequestSpecificFitStatus = (typeof REQUEST_SPECIFIC_FIT_STATUSES)[number];

export type RequestSpecificFitInput = {
  jobCard: RequestJobCard;
  vendorOption: Pick<VendorOptionEligibilityDecision,
    "eligibility_status" | "candidate_id" | "selected_evidence_id" | "truth_flags">;
  evidenceRows: readonly VendorReputationEvidenceRow[];
  now: Date;
};

export type RequestSpecificFitDecision = {
  fit_status: RequestSpecificFitStatus;
  fit_basis: {
    matched_fields: string[];
    evidence_ids: string[];
    confidence: "high" | "medium" | "low" | "none";
    safe_to_display: boolean;
    display_sentence: string | null;
    admin_explanation: string;
    reason_codes: string[];
  };
  administrative_only: true;
  state_mutated: false;
  llm_called: false;
};

type FitSignals = {
  breeds: string[];
  sizes: string[];
  temperaments: string[];
  handlingStyles: string[];
  negativeConstraints: string[];
  excludedBreeds: string[];
  excludedSizes: string[];
  generalGroomingReputation: boolean;
};

type EvidenceWithSignals = {
  row: VendorReputationEvidenceRow;
  signals: FitSignals;
};

const DISPLAYABLE_OPTION_STATUSES = new Set(["eligible_for_internal_review", "missing_terms"]);
const CONFIDENCE_ORDER: Record<SourceConfidenceLevel, number> = {
  trusted: 3, medium: 2, low: 1, untrusted: 0,
};

function normalize(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const result = String(value).trim().toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ");
  return result || null;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(normalize).filter((item): item is string => item !== null))).sort();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Reads only explicit structured signals. It never parses review prose. */
function signals(row: VendorReputationEvidenceRow): FitSignals {
  const payload = row.evidencePayload;
  const nested = object(payload.requestFitEvidence ?? payload.request_fit_evidence ?? payload.fitEvidence);
  const value = Object.keys(nested).length ? nested : payload;
  return {
    breeds: strings(value.breeds ?? value.supportedBreeds ?? value.supported_breeds),
    sizes: strings(value.sizes ?? value.supportedSizes ?? value.supported_sizes),
    temperaments: strings(value.temperaments ?? value.temperamentExperience ?? value.temperament_experience),
    handlingStyles: strings(value.handlingStyles ?? value.handling_styles ?? value.handlingNeeds),
    negativeConstraints: strings(value.negativeConstraints ?? value.negative_constraints),
    excludedBreeds: strings(value.excludedBreeds ?? value.excluded_breeds),
    excludedSizes: strings(value.excludedSizes ?? value.excluded_sizes),
    generalGroomingReputation: value.generalGroomingReputation === true
      || value.general_grooming_reputation === true,
  };
}

function includesMatch(values: readonly string[], requested: string | null): boolean {
  return requested !== null && values.some(value => value === requested);
}

function compatibleSize(evidenceSize: string, requestedSize: string): boolean {
  if (evidenceSize === requestedSize) return true;
  const adjacent: Record<string, string[]> = {
    small: ["small", "small medium", "all sizes"],
    medium: ["medium", "small medium", "medium large", "all sizes"],
    large: ["large", "medium large", "large extra large", "all sizes"],
    "extra large": ["extra large", "large extra large", "all sizes"],
  };
  return (adjacent[requestedSize] ?? [requestedSize]).includes(evidenceSize);
}

function intersects(values: readonly string[], requested: readonly string[]): boolean {
  return requested.some(value => values.includes(value));
}

function dogName(card: RequestJobCard): string {
  const name = card.requestFacts.dog?.name?.trim();
  return name || "this request";
}

function makeDecision(
  status: RequestSpecificFitStatus,
  input: {
    matchedFields?: string[];
    evidenceIds?: string[];
    confidence?: RequestSpecificFitDecision["fit_basis"]["confidence"];
    safe?: boolean;
    sentence?: string | null;
    explanation: string;
    reasons: string[];
  },
): RequestSpecificFitDecision {
  return {
    fit_status: status,
    fit_basis: {
      matched_fields: input.matchedFields ?? [],
      evidence_ids: input.evidenceIds ?? [],
      confidence: input.confidence ?? "none",
      safe_to_display: input.safe ?? false,
      display_sentence: input.safe ? input.sentence ?? null : null,
      admin_explanation: input.explanation,
      reason_codes: Array.from(new Set(input.reasons)),
    },
    administrative_only: true,
    state_mutated: false,
    llm_called: false,
  };
}

function confidence(rows: readonly VendorReputationEvidenceRow[]): "high" | "medium" {
  return rows.some(row => row.sourceConfidence === "trusted") ? "high" : "medium";
}

/**
 * Determines whether a fixed request-specific fit sentence is evidence-backed.
 * No prose ingestion, external calls, storage, ranking mutation, or LLM work.
 */
export function evaluateRequestSpecificFitEvidence(
  input: RequestSpecificFitInput,
): RequestSpecificFitDecision {
  if (!DISPLAYABLE_OPTION_STATUSES.has(input.vendorOption.eligibility_status)) {
    return makeDecision("unsafe_to_display", {
      explanation: "The vendor option did not pass the existing Slice 49 eligibility gate.",
      reasons: ["vendor_option_not_eligible_for_fit_display"],
    });
  }
  if (input.vendorOption.candidate_id.trim() === "") {
    return makeDecision("unsafe_to_display", {
      explanation: "The vendor candidate identity is missing.", reasons: ["candidate_identity_missing"],
    });
  }
  if (input.jobCard.category !== "dog_grooming") {
    return makeDecision("mismatch_or_unknown", {
      explanation: "Request-specific dog fit is outside this policy's supported category.",
      reasons: ["unsupported_service_category"],
    });
  }

  // Reuse the resolver as the first fail-closed check, then retain every row
  // that independently passes the same reputation evidence policy.
  const resolved = resolveCandidateEvidence(input.vendorOption.candidate_id, input.evidenceRows, input.now);
  if (!resolved.snapshot) {
    return makeDecision("unsafe_to_display", {
      explanation: "No fresh, approved, usable evidence exists for this candidate.",
      reasons: ["no_usable_evidence"],
    });
  }
  const usable = input.evidenceRows
    .filter(row => row.candidateId === input.vendorOption.candidate_id)
    .filter(row => evaluateVendorReputationEvidence(row, input.now).status === "usable")
    .filter(row => CONFIDENCE_ORDER[row.sourceConfidence] >= CONFIDENCE_ORDER.medium)
    .map(row => ({ row, signals: signals(row) }))
    .sort((a, b) => CONFIDENCE_ORDER[b.row.sourceConfidence] - CONFIDENCE_ORDER[a.row.sourceConfidence]
      || b.row.observedAt.getTime() - a.row.observedAt.getTime() || a.row.id.localeCompare(b.row.id));
  if (!usable.length) {
    return makeDecision("unsafe_to_display", {
      explanation: "Evidence exists but its confidence is too low for request-specific display.",
      reasons: ["evidence_confidence_too_low"],
    });
  }

  const dog = input.jobCard.requestFacts.dog;
  const requestedBreed = normalize(dog?.breed);
  const requestedSize = normalize(dog?.size);
  const requestedTemperament = normalize(dog?.temperament);
  const requestedHandling = normalize(dog?.handlingNotes);
  const requestedNegatives = (dog?.negativeConstraints ?? []).map(normalize)
    .filter((item): item is string => item !== null);
  const requestFieldsPresent = [requestedBreed, requestedSize, requestedTemperament, requestedHandling]
    .some(Boolean) || requestedNegatives.length > 0;

  const mismatchRows = usable.filter(({ signals: value }) =>
    includesMatch(value.excludedBreeds, requestedBreed)
    || includesMatch(value.excludedSizes, requestedSize)
    || (requestedSize !== null && value.sizes.length > 0
      && !value.sizes.some(size => compatibleSize(size, requestedSize)))
    || intersects(value.negativeConstraints, requestedNegatives));
  if (mismatchRows.length) {
    const ids = mismatchRows.map(item => item.row.id);
    const sizeConflict = requestedSize !== null && mismatchRows.some(item => item.signals.excludedSizes.includes(requestedSize)
      || (item.signals.sizes.length > 0 && !item.signals.sizes.some(size => compatibleSize(size, requestedSize))));
    const sentence = sizeConflict
      ? `The strongest specific evidence concerns other dog sizes, so I’m not treating it as a direct match for ${dogName(input.jobCard)}.`
      : `The available evidence conflicts with a request-specific need, so I’m not treating it as a direct match for ${dogName(input.jobCard)}.`;
    return makeDecision("mismatch_or_unknown", {
      evidenceIds: ids, confidence: confidence(mismatchRows.map(item => item.row)), safe: true, sentence,
      explanation: "Explicit structured evidence conflicts with a request-scoped dog fact.",
      reasons: ["explicit_fit_mismatch"],
    });
  }

  const breedRows = requestedBreed === null ? [] : usable.filter(item => includesMatch(item.signals.breeds, requestedBreed));
  const sizeRows = requestedSize === null ? [] : usable.filter(item =>
    item.signals.sizes.some(size => compatibleSize(size, requestedSize)));
  const temperamentRows = requestedTemperament === null ? [] : usable.filter(item =>
    includesMatch(item.signals.temperaments, requestedTemperament));
  const handlingRows = requestedHandling === null ? [] : usable.filter(item =>
    includesMatch(item.signals.handlingStyles, requestedHandling));
  const matched = [
    ["breed", breedRows], ["size", sizeRows], ["temperament", temperamentRows], ["handling_needs", handlingRows],
  ] as const;
  const matchedFields = matched.filter(([, rows]) => rows.length).map(([field]) => field);
  const matchedRows = Array.from(new Map(matched.flatMap(([, rows]) => rows).map(item => [item.row.id, item])).values());

  if (breedRows.length || matchedFields.length >= 2) {
    const focus = temperamentRows.length ? requestedTemperament
      : handlingRows.length ? requestedHandling
      : requestedBreed ?? requestedSize;
    return makeDecision("strong_match", {
      matchedFields, evidenceIds: matchedRows.map(item => item.row.id),
      confidence: confidence(matchedRows.map(item => item.row)), safe: true,
      sentence: `I found explicit relevant evidence for ${focus}, which fits ${dogName(input.jobCard)}’s request.`,
      explanation: "An exact breed match or multiple request-scoped dog facts are supported by usable evidence.",
      reasons: [breedRows.length ? "exact_breed_evidence" : "multiple_request_facts_matched"],
    });
  }

  if (matchedFields.length === 1) {
    const field = matchedFields[0];
    const missingSpecific = field === "handling_needs" ? requestedSize ? "size" : "breed" : "other request details";
    return makeDecision("partial_match", {
      matchedFields, evidenceIds: matchedRows.map(item => item.row.id),
      confidence: confidence(matchedRows.map(item => item.row)), safe: true,
      sentence: `I found relevant ${field.replaceAll("_", " ")} evidence, but nothing specific to ${missingSpecific}.`,
      explanation: "Exactly one explicit request-scoped dog fact is supported by usable evidence.",
      reasons: [`${field}_evidence_match`, "other_specific_fit_evidence_missing"],
    });
  }

  const generalRows = usable.filter(item => item.signals.generalGroomingReputation
    || (item.row.rating !== null && (item.row.reviewCount ?? 0) > 0));
  if (generalRows.length) {
    const sentence = requestFieldsPresent
      ? `I found general grooming feedback, but no specific evidence tied to ${dogName(input.jobCard)}’s request details.`
      : "I found general grooming feedback, but the request has no specific dog facts to match against it.";
    return makeDecision("general_reputation_only", {
      evidenceIds: generalRows.map(item => item.row.id), confidence: confidence(generalRows.map(item => item.row)),
      safe: true, sentence,
      explanation: "Usable reputation evidence exists, but it contains no explicit matching dog-fit signals.",
      reasons: [requestFieldsPresent ? "specific_fit_evidence_missing" : "request_dog_facts_missing", "general_reputation_evidence_only"],
    });
  }

  return makeDecision("mismatch_or_unknown", {
    evidenceIds: usable.map(item => item.row.id), confidence: confidence(usable.map(item => item.row)),
    safe: true, sentence: "I did not find enough specific evidence to make a dog-fit claim.",
    explanation: "Usable evidence exists, but it does not support a specific or general grooming-fit statement.",
    reasons: ["no_relevant_fit_evidence"],
  });
}
