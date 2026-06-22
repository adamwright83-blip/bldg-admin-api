import type { RequestJobCard } from "./requestJobCardPolicy";
import {
  evaluateVendorMatchEvaluationCandidate,
  type VendorMatchEvaluationCandidateInput,
  type VendorMatchEvaluationCandidateDecision,
} from "./vendorMatchEvaluationPolicy";
import type { VendorMatchPreferences } from "./vendorPreferenceMatchingPolicy";
import {
  buildVendorProposal,
  type VendorProposalDecision,
  type VendorResponseTermsSnapshot,
} from "./vendorProposalBuilderPolicy";
import {
  hasProviderAcceptance,
  hasVerifiedBooking,
  type ProviderAcceptancePolicyView,
} from "./providerAcceptancePolicy";
import {
  evaluateVendorProposalApprovalGate,
  type ProposalApprovalGateDecision,
} from "./vendorProposalApprovalGatePolicy";

export const VENDOR_OPTION_ELIGIBILITY_STATUSES = [
  "eligible_for_internal_review",
  "ineligible",
  "needs_operator_review",
  "missing_terms",
  "expired_or_stale_evidence",
  "outside_scope",
  "unsafe_to_present",
] as const;

export type VendorOptionEligibilityStatus = (typeof VENDOR_OPTION_ELIGIBILITY_STATUSES)[number];

export type VendorOptionCandidate = VendorMatchEvaluationCandidateInput & {
  businessName: string | null;
  serviceCategory: string | null;
  sourceStatus: string | null;
  sourceApproved: boolean;
};

export type VendorOptionConstraints = {
  maximumBudgetCents: number | null;
  scheduledAt: Date | null;
};

export type VendorOptionEligibilityInput = {
  jobCard: RequestJobCard;
  candidate: VendorOptionCandidate;
  preferences: VendorMatchPreferences;
  terms: readonly VendorResponseTermsSnapshot[];
  constraints: VendorOptionConstraints;
  providerAcceptance?: ProviderAcceptancePolicyView | null;
  manualOutreachEvidencePresent?: boolean;
  now: Date;
};

export type VendorOptionReadinessReason = {
  code: string;
  explanation: string;
};

export type VendorOptionTruthFlags = {
  available_not_booked: boolean;
  not_provider_accepted: true;
  not_paid: true;
  not_dispatched: true;
  not_completed: true;
  vendor_contacted: boolean;
  price_confirmed_by_terms: boolean;
  resident_proposal_allowed: false;
};

export type VendorOptionEligibilityDecision = {
  eligibility_status: VendorOptionEligibilityStatus;
  readiness_reasons: VendorOptionReadinessReason[];
  truth_flags: VendorOptionTruthFlags;
  candidate_id: string;
  selected_evidence_id: string | null;
  selected_terms_id: string | null;
  quoted_amount_cents: number | null;
  match_decision: VendorMatchEvaluationCandidateDecision | null;
  proposal_readiness: VendorProposalDecision | null;
  approval_gate: ProposalApprovalGateDecision | null;
  administrative_only: true;
  state_mutated: false;
  llm_called: false;
};

const EXPLANATIONS: Record<string, string> = {
  job_card_not_allowed: "The canonical job card is not safe to use.",
  job_card_needs_clarification: "Required request facts are missing; clarification is required first.",
  candidate_identity_missing: "The vendor candidate does not have a durable identity.",
  candidate_business_name_missing: "The vendor business identity is incomplete.",
  candidate_source_not_approved: "The candidate source has not been approved.",
  candidate_not_approved_for_outreach: "The candidate has not passed the existing sourcing approval gate.",
  service_category_missing: "The candidate service category is missing.",
  service_category_mismatch: "The candidate service category does not match the job card.",
  source_confidence_below_threshold: "Source confidence is below the configured threshold.",
  evidence_missing: "No usable reputation evidence supports this option.",
  evidence_expired: "The supporting reputation evidence is expired.",
  evidence_stale_or_invalid: "The supporting reputation evidence is stale or invalid.",
  evidence_not_approved: "The supporting evidence source is not approved.",
  evidence_blocked: "The supporting evidence failed a safety or compliance gate.",
  terms_missing: "No real vendor response terms are available; this cannot become a resident proposal.",
  terms_expired: "The vendor response terms are expired.",
  vendor_unavailable: "Real response terms say the vendor is unavailable or declined the request.",
  terms_need_clarification: "The vendor response terms require operator clarification.",
  terms_unsupported: "The vendor response does not support this request.",
  terms_invalid_or_unsafe: "The response terms are invalid or contain unsafe claims.",
  availability_not_supported: "Real response terms do not support an availability claim.",
  price_not_supported: "Real response terms do not support a certain price claim.",
  budget_conflict: "The quoted price exceeds the resident budget constraint.",
  timing_conflict: "The vendor availability does not satisfy the requested timing constraint.",
  request_constraints_missing: "Budget or timing constraints are missing or invalid.",
  low_confidence_terms: "Vendor terms have low confidence and require operator review.",
  existing_provider_truth_present: "Provider acceptance or verified-booking truth already exists; this pre-proposal view is no longer authoritative.",
  eligible_for_internal_review: "The option is supported for internal review only; it is not booked or provider accepted.",
};

function reason(code: string): VendorOptionReadinessReason {
  return { code, explanation: EXPLANATIONS[code] ?? `Existing policy gate: ${code.replaceAll("_", " ")}.` };
}

function uniqueReasons(codes: readonly string[]): VendorOptionReadinessReason[] {
  return Array.from(new Set(codes)).map(reason);
}

function truth(input: {
  available: boolean;
  contacted: boolean;
  priceSupported: boolean;
}): VendorOptionTruthFlags {
  return {
    available_not_booked: input.available,
    not_provider_accepted: true,
    not_paid: true,
    not_dispatched: true,
    not_completed: true,
    vendor_contacted: input.contacted,
    price_confirmed_by_terms: input.priceSupported,
    resident_proposal_allowed: false,
  };
}

function decision(input: {
  status: VendorOptionEligibilityStatus;
  codes: string[];
  source: VendorOptionEligibilityInput;
  match?: VendorMatchEvaluationCandidateDecision | null;
  proposal?: VendorProposalDecision | null;
  gate?: ProposalApprovalGateDecision | null;
  available?: boolean;
  priceSupported?: boolean;
}): VendorOptionEligibilityDecision {
  return {
    eligibility_status: input.status,
    readiness_reasons: uniqueReasons(input.codes),
    truth_flags: truth({
      available: input.available === true,
      contacted: input.source.manualOutreachEvidencePresent === true,
      priceSupported: input.priceSupported === true,
    }),
    candidate_id: input.source.candidate.candidateId,
    selected_evidence_id: input.match?.evidenceSummary.selectedEvidenceId ?? null,
    selected_terms_id: input.proposal?.selectedTermsId ?? null,
    quoted_amount_cents: input.proposal?.proposalDetails?.quotedAmountCents ?? null,
    match_decision: input.match ?? null,
    proposal_readiness: input.proposal ?? null,
    approval_gate: input.gate ?? null,
    administrative_only: true,
    state_mutated: false,
    llm_called: false,
  };
}

function validConstraintInput(constraints: VendorOptionConstraints): constraints is {
  maximumBudgetCents: number;
  scheduledAt: Date;
} {
  return Number.isSafeInteger(constraints.maximumBudgetCents)
    && (constraints.maximumBudgetCents as number) >= 0
    && constraints.scheduledAt instanceof Date
    && Number.isFinite(constraints.scheduledAt.getTime());
}

function mapMatchReasons(match: VendorMatchEvaluationCandidateDecision): string[] {
  const codes: string[] = [];
  for (const value of [...match.decisionReasons, ...match.riskFlags]) {
    if (value === "evidence_expired" || value === "rating_evidence_stale_or_invalid") codes.push("evidence_expired");
    else if (value === "source_not_approved" || value === "rating_source_not_approved") codes.push("evidence_not_approved");
    else if (value === "source_confidence_below_threshold" || value === "source_confidence_untrusted") codes.push("source_confidence_below_threshold");
    else if (value === "no_evidence_rows" || value === "rating_evidence_missing") codes.push("evidence_missing");
    else if (value.startsWith("protected_or_proxy_field") || value.includes("quarantined") || value === "evidence_blocked") codes.push("evidence_blocked");
    else codes.push(value);
  }
  return codes;
}

/**
 * Pure Slice 49 orchestration over existing procurement policies. It only
 * decides whether an option may be reviewed internally. It never contacts a
 * vendor, builds durable proposals, or advances booking/payment/dispatch truth.
 */
export function evaluateVendorOptionEligibility(
  input: VendorOptionEligibilityInput,
): VendorOptionEligibilityDecision {
  if (input.jobCard.status === "job_card_not_allowed" || !input.jobCard.jobCardAllowed) {
    return decision({ status: "unsafe_to_present", codes: ["job_card_not_allowed"], source: input });
  }
  if (input.jobCard.status === "job_card_needs_clarification") {
    return decision({ status: "needs_operator_review", codes: ["job_card_needs_clarification"], source: input });
  }
  if (!input.candidate.candidateId.trim()) {
    return decision({ status: "unsafe_to_present", codes: ["candidate_identity_missing"], source: input });
  }
  if (!input.candidate.businessName?.trim()) {
    return decision({ status: "needs_operator_review", codes: ["candidate_business_name_missing"], source: input });
  }
  if (!input.candidate.serviceCategory?.trim()) {
    return decision({ status: "outside_scope", codes: ["service_category_missing"], source: input });
  }
  if (input.candidate.serviceCategory !== input.jobCard.category) {
    return decision({ status: "outside_scope", codes: ["service_category_mismatch"], source: input });
  }
  if (!input.candidate.sourceApproved) {
    return decision({ status: "needs_operator_review", codes: ["candidate_source_not_approved"], source: input });
  }
  if (input.candidate.sourceStatus !== "approved_for_outreach") {
    return decision({ status: "needs_operator_review", codes: ["candidate_not_approved_for_outreach"], source: input });
  }

  if (input.providerAcceptance
      && (hasProviderAcceptance(input.providerAcceptance) || hasVerifiedBooking(input.providerAcceptance))) {
    return decision({ status: "unsafe_to_present", codes: ["existing_provider_truth_present"], source: input });
  }

  const match = evaluateVendorMatchEvaluationCandidate(input.candidate, input.preferences, input.now);
  const matchCodes = mapMatchReasons(match);
  if (match.matchStatus === "blocked") {
    return decision({ status: "unsafe_to_present", codes: matchCodes, source: input, match });
  }
  if (match.evidenceSummary.evidenceStatus === "needs_review"
      && matchCodes.includes("evidence_expired")) {
    return decision({ status: "expired_or_stale_evidence", codes: matchCodes, source: input, match });
  }
  if (match.matchStatus === "needs_review") {
    return decision({ status: "needs_operator_review", codes: matchCodes, source: input, match });
  }
  if (match.matchStatus === "not_matched") {
    return decision({ status: "ineligible", codes: matchCodes, source: input, match });
  }

  if (!input.terms.length) {
    return decision({ status: "missing_terms", codes: ["terms_missing"], source: input, match });
  }
  if (!validConstraintInput(input.constraints)) {
    return decision({ status: "needs_operator_review", codes: ["request_constraints_missing"], source: input, match });
  }

  const proposal = buildVendorProposal({
    termsList: input.terms,
    requestContext: { serviceType: input.jobCard.category },
    constraints: {
      maxPriceCents: input.constraints.maximumBudgetCents,
      scheduledAt: input.constraints.scheduledAt,
    },
    candidateContext: {
      candidateId: input.candidate.candidateId,
      businessName: input.candidate.businessName,
    },
    now: input.now,
  });

  const proposalReasons = proposal.reasons;
  if (proposalReasons.includes("response_terms_expired")) {
    return decision({ status: "expired_or_stale_evidence", codes: ["terms_expired"], source: input, match, proposal });
  }
  if (proposal.status === "proposal_vendor_declined") {
    return decision({ status: "ineligible", codes: ["vendor_unavailable"], source: input, match, proposal });
  }
  if (proposal.status === "proposal_needs_clarification") {
    return decision({ status: "needs_operator_review", codes: ["terms_need_clarification"], source: input, match, proposal });
  }
  if (proposal.status === "proposal_unsupported") {
    return decision({ status: "outside_scope", codes: ["terms_unsupported"], source: input, match, proposal });
  }
  if (proposal.status === "proposal_not_allowed") {
    return decision({ status: "unsafe_to_present", codes: ["terms_invalid_or_unsafe", ...proposalReasons], source: input, match, proposal });
  }
  if (proposal.status === "proposal_requirements_missing") {
    const budgetConflict = proposalReasons.includes("quoted_price_exceeds_budget_constraint");
    const timingConflict = proposalReasons.includes("schedule_mismatch");
    const missingAvailability = proposalReasons.some(value => value === "availability_unknown" || value === "availability_windows_missing");
    const missingPrice = proposalReasons.includes("rate_info_missing");
    const codes = [
      ...(budgetConflict ? ["budget_conflict"] : []),
      ...(timingConflict ? ["timing_conflict"] : []),
      ...(missingAvailability ? ["availability_not_supported"] : []),
      ...(missingPrice ? ["price_not_supported"] : []),
      ...proposalReasons,
    ];
    return decision({
      status: budgetConflict || timingConflict ? "ineligible" : "missing_terms",
      codes,
      source: input,
      match,
      proposal,
    });
  }

  const gate = evaluateVendorProposalApprovalGate({
    proposal: {
      status: proposal.status,
      allowed: proposal.allowed,
      reasons: proposal.reasons,
      riskFlags: proposal.riskFlags,
      selectedTermsId: proposal.selectedTermsId,
      proposalDetails: proposal.proposalDetails,
    },
    requestContext: { serviceType: input.jobCard.category, scheduledAt: input.constraints.scheduledAt },
    budgetContext: { mandateBudgetLimitCents: input.constraints.maximumBudgetCents },
    residentApprovalContext: {},
    operatorGate: null,
    now: input.now,
  });
  if (gate.status === "proposal_requires_operator_review") {
    return decision({
      status: "needs_operator_review",
      codes: proposal.riskFlags.includes("low_confidence_terms")
        ? ["low_confidence_terms", ...gate.reasons]
        : gate.reasons,
      source: input,
      match,
      proposal,
      gate,
      available: true,
      priceSupported: proposal.proposalDetails?.quotedAmountCents !== null,
    });
  }
  if (gate.status !== "proposal_approved_for_next_step_only") {
    return decision({ status: "needs_operator_review", codes: gate.reasons, source: input, match, proposal, gate });
  }

  return decision({
    status: "eligible_for_internal_review",
    codes: ["eligible_for_internal_review"],
    source: input,
    match,
    proposal,
    gate,
    available: true,
    priceSupported: proposal.proposalDetails?.quotedAmountCents !== null,
  });
}
