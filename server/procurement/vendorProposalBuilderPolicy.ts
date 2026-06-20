export type VendorResponseTermsSnapshot = {
  id?: string;
  workflowId?: string | null;
  candidateId?: string;
  outreachEventId?: string;
  interpretationStatus?: "interpreted" | "needs_clarification" | "unsupported" | "declined" | "invalid" | null;
  availabilityStatus?: "available" | "unavailable" | "unknown" | "needs_clarification" | null;
  rateStatus?: "provided" | "not_provided" | "needs_clarification" | null;
  quotedAmount?: number | null;
  quotedCurrency?: string | null;
  rateUnit?: string | null;
  availabilityWindowsJson?: Record<string, unknown>[] | null;
  constraintsJson?: Record<string, unknown> | null;
  termsSummaryJson?: Record<string, unknown> | null;
  confidence?: "high" | "medium" | "low" | null;
  observedAt?: Date | string | null;
  expiresAt?: Date | string | null;
  createdBy?: string | null;

  // support snake_case row names too
  interpretation_status?: "interpreted" | "needs_clarification" | "unsupported" | "declined" | "invalid" | null;
  availability_status?: "available" | "unavailable" | "unknown" | "needs_clarification" | null;
  rate_status?: "provided" | "not_provided" | "needs_clarification" | null;
  quoted_amount?: number | null;
  quoted_currency?: string | null;
  rate_unit?: string | null;
  availability_windows_json?: Record<string, unknown>[] | null;
  constraints_json?: Record<string, unknown> | null;
  terms_summary_json?: Record<string, unknown> | null;
  observed_at?: Date | string | null;
  expires_at?: Date | string | null;
  created_by?: string | null;
};

export type RequestContext = {
  workflowId?: string | null;
  serviceType?: string | null;
  accessPattern?: string | null;
};

export type BudgetScheduleConstraints = {
  maxPriceCents: number;
  scheduledAt: Date;
};

export type CandidateContext = {
  candidateId: string;
  vendorId?: string | null;
  businessName?: string | null;
};

export type VendorProposalInput = {
  termsList: readonly VendorResponseTermsSnapshot[];
  requestContext: RequestContext;
  constraints: BudgetScheduleConstraints;
  candidateContext: CandidateContext;
  now?: Date;
};

export type VendorProposalDecision = {
  status:
    | "proposal_not_allowed"
    | "proposal_requirements_missing"
    | "proposal_ready_for_review"
    | "proposal_needs_clarification"
    | "proposal_vendor_declined"
    | "proposal_unsupported";
  allowed: boolean;
  reasons: string[];
  riskFlags: string[];
  selectedTermsId: string | null;
  proposalDetails: {
    candidateId: string;
    quotedAmountCents: number | null;
    currency: string | null;
    rateUnit: string | null;
    confidence: "high" | "medium" | "low";
  } | null;
  // Hardcoded forbidden claims/outcome parameters
  booked: false;
  accepted: false;
  dispatched: false;
  paid: false;
  captured: false;
  completed: false;
  selectedForExecution: false;
  providerAccepted: false;
  bookingVerified: false;
  paymentAuthorized: false;
  paymentCaptured: false;
  invoiceCreated: false;
  payableCreated: false;
};

const BANNED_PROPOSAL_CLAIMS: Array<{ key: string; pattern: RegExp }> = [
  { key: "booked_claim", pattern: /\bbooked\b/i },
  { key: "accepted_claim", pattern: /\baccepted\b/i },
  { key: "dispatched_claim", pattern: /\bdispatched\b/i },
  { key: "paid_claim", pattern: /\bpaid\b/i },
  { key: "captured_claim", pattern: /\bcaptured\b/i },
  { key: "completed_claim", pattern: /\bcompleted\b/i },
  { key: "selected_for_execution_claim", pattern: /\bselected[_ ]for[_ ]execution\b/i },
  { key: "provider_message_id_claim", pattern: /\b(provider[_ ]message[_ ]id|providermessageid)\b/i },
  { key: "delivery_receipt_claim", pattern: /\bdelivery[_ ](receipt|confirmation)\b/i },
  { key: "automated_held_send_claim", pattern: /\b((held|we) (?:automatically )?sent|automated held send|automatically sent by held)\b/i },
  { key: "sent_by_held_claim", pattern: /\bsent[_ ]by[_ ]held\b/i },
  { key: "guaranteed_provider_commitment_claim", pattern: /\b(guaranteed provider commitment|provider commitment|guaranteed commitment)\b/i },
];

function checkBannedClaims(text: string): string[] {
  const blocking: string[] = [];
  for (const claim of BANNED_PROPOSAL_CLAIMS) {
    if (claim.pattern.test(text)) {
      blocking.push(claim.key);
    }
  }
  return blocking;
}

function makeProposalDecision(
  status: VendorProposalDecision["status"],
  reasons: string[],
  riskFlags: string[],
  selectedTermsId: string | null,
  proposalDetails: VendorProposalDecision["proposalDetails"]
): VendorProposalDecision {
  return {
    status,
    allowed: status === "proposal_ready_for_review",
    reasons,
    riskFlags,
    selectedTermsId,
    proposalDetails,
    booked: false,
    accepted: false,
    dispatched: false,
    paid: false,
    captured: false,
    completed: false,
    selectedForExecution: false,
    providerAccepted: false,
    bookingVerified: false,
    paymentAuthorized: false,
    paymentCaptured: false,
    invoiceCreated: false,
    payableCreated: false,
  };
}

export function compareTerms(
  a: VendorResponseTermsSnapshot,
  b: VendorResponseTermsSnapshot,
  now: Date
): number {
  const aExpiresVal = a.expiresAt ?? a.expires_at;
  const bExpiresVal = b.expiresAt ?? b.expires_at;
  const aExpires = aExpiresVal ? new Date(aExpiresVal) : null;
  const bExpires = bExpiresVal ? new Date(bExpiresVal) : null;

  const aExpired = aExpires ? aExpires.getTime() <= now.getTime() : false;
  const bExpired = bExpires ? bExpires.getTime() <= now.getTime() : false;

  // 1. non-expired over expired
  if (aExpired !== bExpired) {
    return aExpired ? 1 : -1;
  }

  // 2. higher confidence over lower confidence
  const confMap: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const aConf = confMap[a.confidence ?? "low"] ?? 1;
  const bConf = confMap[b.confidence ?? "low"] ?? 1;
  if (aConf !== bConf) {
    return bConf - aConf;
  }

  // 3. available over unknown
  const aAvail = a.availabilityStatus ?? a.availability_status ?? "unknown";
  const bAvail = b.availabilityStatus ?? b.availability_status ?? "unknown";
  const aIsAvailable = aAvail === "available";
  const bIsAvailable = bAvail === "available";
  if (aIsAvailable !== bIsAvailable) {
    return aIsAvailable ? -1 : 1;
  }

  // 4. rate provided over not_provided
  const aRate = a.rateStatus ?? a.rate_status ?? "not_provided";
  const bRate = b.rateStatus ?? b.rate_status ?? "not_provided";
  const aRateProvided = aRate === "provided";
  const bRateProvided = bRate === "provided";
  if (aRateProvided !== bRateProvided) {
    return aRateProvided ? -1 : 1;
  }

  // 5. latest observed_at
  const aObservedVal = a.observedAt ?? a.observed_at ?? 0;
  const bObservedVal = b.observedAt ?? b.observed_at ?? 0;
  const aObserved = new Date(aObservedVal).getTime();
  const bObserved = new Date(bObservedVal).getTime();
  if (aObserved !== bObserved) {
    return bObserved - aObserved;
  }

  // 6. stable id tie-break
  const aId = a.id ?? "";
  const bId = b.id ?? "";
  return aId.localeCompare(bId);
}

export function buildVendorProposal(
  input: VendorProposalInput
): VendorProposalDecision {
  const { termsList, constraints, candidateContext } = input;
  const now = input.now ?? new Date();

  // 1. Fail closed if no terms available
  if (!termsList || termsList.length === 0) {
    return makeProposalDecision("proposal_requirements_missing", ["no_response_terms_available"], [], null, null);
  }

  // 2. Sort to select the active terms snapshot
  const sorted = [...termsList].sort((a, b) => compareTerms(a, b, now));
  const selected = sorted[0];
  const selectedId = selected.id ?? null;

  // 3. Check for forbidden claims in selected terms
  const summaryStr = JSON.stringify(selected.termsSummaryJson ?? selected.terms_summary_json ?? {});
  const claimText = [selected.createdBy ?? selected.created_by ?? "", summaryStr].join("\n");
  const bannedClaims = checkBannedClaims(claimText);
  if (bannedClaims.length > 0) {
    return makeProposalDecision("proposal_not_allowed", ["forbidden_claim", ...bannedClaims], [], selectedId, null);
  }

  const interpretationStatus = selected.interpretationStatus ?? selected.interpretation_status ?? "invalid";
  const availabilityStatus = selected.availabilityStatus ?? selected.availability_status ?? "unknown";
  const rateStatus = selected.rateStatus ?? selected.rate_status ?? "not_provided";

  const quotedAmount = selected.quotedAmount ?? selected.quoted_amount ?? null;
  const quotedCurrency = selected.quotedCurrency ?? selected.quoted_currency ?? null;
  const rateUnit = selected.rateUnit ?? selected.rate_unit ?? null;
  const confidence = selected.confidence ?? "low";

  const expiresVal = selected.expiresAt ?? selected.expires_at;
  const expiresAt = expiresVal ? new Date(expiresVal) : null;
  const isExpired = expiresAt ? expiresAt.getTime() <= now.getTime() : false;

  const reasons: string[] = [];
  const riskFlags: string[] = [];

  // Capture confidence risk
  if (confidence === "low") {
    riskFlags.push("low_confidence_terms");
  }

  // Capture expiring soon risk (e.g. within 2 hours)
  if (expiresAt) {
    const twoHoursMs = 2 * 60 * 60 * 1000;
    if (expiresAt.getTime() - now.getTime() < twoHoursMs && !isExpired) {
      riskFlags.push("expires_soon");
    }
  }

  // 4. Route based on interpretation Status
  if (interpretationStatus === "declined" || availabilityStatus === "unavailable") {
    return makeProposalDecision("proposal_vendor_declined", ["vendor_declined_work"], riskFlags, selectedId, null);
  }

  if (interpretationStatus === "needs_clarification" || availabilityStatus === "needs_clarification" || rateStatus === "needs_clarification") {
    return makeProposalDecision("proposal_needs_clarification", ["vendor_requested_clarification"], riskFlags, selectedId, null);
  }

  if (interpretationStatus === "unsupported") {
    return makeProposalDecision("proposal_unsupported", ["vendor_unsupported_request"], riskFlags, selectedId, null);
  }

  if (interpretationStatus === "invalid") {
    return makeProposalDecision("proposal_not_allowed", ["response_terms_invalid"], riskFlags, selectedId, null);
  }

  // 5. Fail closed if expired
  if (isExpired) {
    return makeProposalDecision("proposal_requirements_missing", ["response_terms_expired"], riskFlags, selectedId, null);
  }

  // 6. Fail closed on missing rate or availability
  if (availabilityStatus === "unknown") {
    reasons.push("availability_unknown");
  }
  if (rateStatus === "not_provided" || quotedAmount === null) {
    reasons.push("rate_info_missing");
  }

  // 7. Validate budget and schedule constraints
  if (quotedAmount !== null) {
    if (quotedCurrency && quotedCurrency !== "USD") {
      reasons.push(`unsupported_currency:${quotedCurrency}`);
    } else {
      const quotedCents = Math.round(quotedAmount * 100);
      if (quotedCents > constraints.maxPriceCents) {
        reasons.push("quoted_price_exceeds_budget_constraint");
      }
    }
  }

  const windows = selected.availabilityWindowsJson ?? selected.availability_windows_json ?? [];
  if (windows.length > 0) {
    let scheduleMatched = false;
    for (const win of windows) {
      if (win.start && win.end) {
        const start = new Date(win.start as any);
        const end = new Date(win.end as any);
        if (
          Number.isFinite(start.getTime()) &&
          Number.isFinite(end.getTime()) &&
          constraints.scheduledAt.getTime() >= start.getTime() &&
          constraints.scheduledAt.getTime() <= end.getTime()
        ) {
          scheduleMatched = true;
          break;
        }
      }
    }
    if (!scheduleMatched) {
      reasons.push("schedule_mismatch");
    }
  } else if (availabilityStatus === "available") {
    reasons.push("availability_windows_missing");
  }

  if (reasons.length > 0) {
    return makeProposalDecision("proposal_requirements_missing", reasons, riskFlags, selectedId, null);
  }

  // 8. Ready for review
  const quotedAmountCents = quotedAmount !== null ? Math.round(quotedAmount * 100) : null;
  const proposalDetails = {
    candidateId: candidateContext.candidateId,
    quotedAmountCents,
    currency: quotedCurrency ?? "USD",
    rateUnit,
    confidence,
  };

  return makeProposalDecision("proposal_ready_for_review", ["proposal_ready_for_review"], riskFlags, selectedId, proposalDetails);
}
