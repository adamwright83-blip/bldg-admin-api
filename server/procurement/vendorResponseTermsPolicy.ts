import { type VendorResponseInterpretationDecision } from "./vendorResponseInterpretationPolicy";

export type VendorResponseTermsInput = {
  interpretation: VendorResponseInterpretationDecision;
  event: {
    id: string;
    workflowId: string | null;
    candidateId: string;
    occurredAt: Date;
    createdBy: string;
    summary: string;
    rawPayload: Record<string, unknown>;
  };
  now?: Date;
};

export type VendorResponseTerms = {
  workflowId: string | null;
  candidateId: string;
  outreachEventId: string;
  interpretationStatus: "interpreted" | "needs_clarification" | "unsupported" | "declined" | "invalid";
  availabilityStatus: "available" | "unavailable" | "unknown" | "needs_clarification";
  rateStatus: "provided" | "not_provided" | "needs_clarification";
  quotedAmount: number | null;
  quotedCurrency: string | null;
  rateUnit: string | null;
  availabilityWindowsJson: Record<string, unknown>[];
  constraintsJson: Record<string, unknown>;
  termsSummaryJson: Record<string, unknown>;
  confidence: "high" | "medium" | "low";
  observedAt: Date;
  expiresAt: Date | null;
  createdBy: string;
};

export type VendorResponseTermsDecision = {
  allowed: boolean;
  reasons: string[];
  terms: VendorResponseTerms | null;
  proposalReady: boolean;
  booked: false;
  accepted: false;
  dispatched: false;
  paid: false;
  captured: false;
  completed: false;
  selectedForExecution: false;
  providerMessageCreated: false;
  deliveryVerified: false;
};

const BANNED_TERMS_CLAIMS: Array<{ key: string; pattern: RegExp }> = [
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
  for (const claim of BANNED_TERMS_CLAIMS) {
    if (claim.pattern.test(text)) {
      blocking.push(claim.key);
    }
  }
  return blocking;
}

function makeTermsDecision(
  allowed: boolean,
  reasons: string[],
  terms: VendorResponseTerms | null,
  proposalReady: boolean
): VendorResponseTermsDecision {
  return {
    allowed,
    reasons,
    terms,
    proposalReady,
    booked: false,
    accepted: false,
    dispatched: false,
    paid: false,
    captured: false,
    completed: false,
    selectedForExecution: false,
    providerMessageCreated: false,
    deliveryVerified: false,
  };
}

export function evaluateVendorResponseTerms(
  input: VendorResponseTermsInput
): VendorResponseTermsDecision {
  const { interpretation, event } = input;
  const now = input.now ?? new Date();

  // 1. Check if interpretation itself was disallowed or invalid
  if (!interpretation.allowed || interpretation.classification === "response_invalid") {
    return makeTermsDecision(false, ["interpretation_invalid", ...interpretation.reasons], null, false);
  }

  // 2. Double-check for banned claims locally
  const claimText = [event.summary, JSON.stringify(event.rawPayload)].join("\n");
  const bannedClaims = checkBannedClaims(claimText);
  if (bannedClaims.length > 0) {
    return makeTermsDecision(false, ["forbidden_claim", ...bannedClaims], null, false);
  }

  // 3. Map classification to status
  let interpretationStatus: VendorResponseTerms["interpretationStatus"] = "interpreted";
  let availabilityStatus: VendorResponseTerms["availabilityStatus"] = "unknown";
  let rateStatus: VendorResponseTerms["rateStatus"] = "not_provided";

  const classification = interpretation.classification;
  if (classification === "vendor_declined") {
    interpretationStatus = "declined";
    availabilityStatus = "unavailable";
  } else if (classification === "vendor_available") {
    interpretationStatus = "interpreted";
    availabilityStatus = "available";
  } else if (classification === "vendor_rate_info_provided") {
    interpretationStatus = "interpreted";
    rateStatus = "provided";
  } else if (classification === "vendor_needs_clarification") {
    interpretationStatus = "needs_clarification";
    availabilityStatus = "needs_clarification";
    rateStatus = "needs_clarification";
  } else if (classification === "vendor_unavailable") {
    interpretationStatus = "interpreted";
    availabilityStatus = "unavailable";
  } else if (classification === "vendor_unsupported") {
    interpretationStatus = "unsupported";
  } else if (classification === "vendor_general_response") {
    interpretationStatus = "interpreted";
  } else {
    interpretationStatus = "invalid";
  }

  // 4. Extract terms details from rawPayload (checking both camelCase and snake_case)
  const raw = event.rawPayload ?? {};

  // Extract quoted amount (ensure it's a valid positive number)
  let quotedAmount: number | null = null;
  const rawAmount = raw.quotedAmount ?? raw.quoted_amount ?? raw.amount ?? raw.rate_amount;
  if (rawAmount !== undefined && rawAmount !== null) {
    const num = Number(rawAmount);
    if (Number.isFinite(num) && num >= 0) {
      quotedAmount = num;
      // Upgrade rateStatus to provided if we have a valid amount and wasn't set to invalid/needs_clarification
      if (rateStatus === "not_provided" && interpretationStatus === "interpreted") {
        rateStatus = "provided";
      }
    }
  }

  // Extract currency
  let quotedCurrency: string | null = null;
  const rawCurrency = raw.quotedCurrency ?? raw.quoted_currency ?? raw.currency;
  if (typeof rawCurrency === "string") {
    quotedCurrency = rawCurrency.toUpperCase().slice(0, 3);
  } else if (quotedAmount !== null) {
    quotedCurrency = "USD"; // Default to USD if amount provided but no currency
  }

  // Extract rate unit
  let rateUnit: string | null = null;
  const rawUnit = raw.rateUnit ?? raw.rate_unit ?? raw.unit;
  if (typeof rawUnit === "string") {
    rateUnit = rawUnit.trim();
  }

  // Extract availability windows
  let availabilityWindowsJson: Record<string, unknown>[] = [];
  const rawWindows = raw.availabilityWindows ?? raw.availability_windows ?? raw.windows;
  if (Array.isArray(rawWindows)) {
    availabilityWindowsJson = rawWindows.filter(
      (w): w is Record<string, unknown> => typeof w === "object" && w !== null
    );
    // Upgrade availabilityStatus to available if we have windows and it was unknown/general
    if (availabilityStatus === "unknown" && interpretationStatus === "interpreted" && availabilityWindowsJson.length > 0) {
      availabilityStatus = "available";
    }
  }

  // Extract constraints
  let constraintsJson: Record<string, unknown> = {};
  const rawConstraints = raw.constraints;
  if (typeof rawConstraints === "object" && rawConstraints !== null) {
    constraintsJson = rawConstraints as Record<string, unknown>;
  }

  // Extract terms summary
  let termsSummaryJson: Record<string, unknown> = {};
  const rawSummary = raw.termsSummary ?? raw.terms_summary ?? raw.summary_details;
  if (typeof rawSummary === "object" && rawSummary !== null) {
    termsSummaryJson = rawSummary as Record<string, unknown>;
  } else {
    termsSummaryJson = { text: event.summary };
  }

  // Extract confidence
  let confidence: VendorResponseTerms["confidence"] = "low";
  const rawConfidence = raw.confidence;
  if (rawConfidence === "high" || rawConfidence === "medium" || rawConfidence === "low") {
    confidence = rawConfidence;
  } else if (interpretationStatus === "interpreted") {
    confidence = "medium";
  }

  // Extract expiresAt
  let expiresAt: Date | null = null;
  const rawExpires = raw.expiresAt ?? raw.expires_at ?? raw.expiry;
  if (rawExpires) {
    const d = new Date(rawExpires as any);
    if (Number.isFinite(d.getTime())) {
      expiresAt = d;
    }
  }

  // 5. Construct Terms object
  const terms: VendorResponseTerms = {
    workflowId: event.workflowId,
    candidateId: event.candidateId,
    outreachEventId: event.id,
    interpretationStatus,
    availabilityStatus,
    rateStatus,
    quotedAmount,
    quotedCurrency,
    rateUnit,
    availabilityWindowsJson,
    constraintsJson,
    termsSummaryJson,
    confidence,
    observedAt: event.occurredAt,
    expiresAt,
    createdBy: event.createdBy,
  };

  // 6. Evaluate Proposal Readiness
  // Unsupported / needs clarification must fail closed. Expired terms are not proposal-ready.
  const isExpired = expiresAt ? expiresAt.getTime() <= now.getTime() : false;
  const proposalReady =
    interpretationStatus === "interpreted" &&
    availabilityStatus === "available" &&
    !isExpired;

  return makeTermsDecision(true, [], terms, proposalReady);
}
