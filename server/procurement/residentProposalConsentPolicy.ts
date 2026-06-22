import type { ResidentProposalPresentationContract } from "./residentProposalPresentationContract";

export const RESIDENT_PROPOSAL_CONSENT_ACTION = "approve_held_to_try_to_book" as const;
export const RESIDENT_PROPOSAL_CONSENT_COPY_VERSION = "v1" as const;

export type ResidentProposalConsentOutcome =
  | "consent_recorded"
  | "consent_already_recorded"
  | "consent_not_allowed"
  | "invalid_request";

export type ResidentProposalConsentDecision = {
  outcome: ResidentProposalConsentOutcome;
  allowed: boolean;
  reasons: string[];
  outreachSent: false;
  vendorContacted: false;
  booked: false;
  accepted: false;
  paid: false;
  captured: false;
  dispatched: false;
  completed: false;
  llmCalled: false;
};

function result(outcome: ResidentProposalConsentOutcome, reasons: string[]): ResidentProposalConsentDecision {
  return {
    outcome, allowed: outcome === "consent_recorded" || outcome === "consent_already_recorded",
    reasons: Array.from(new Set(reasons)),
    outreachSent: false, vendorContacted: false, booked: false, accepted: false,
    paid: false, captured: false, dispatched: false, completed: false, llmCalled: false,
  };
}

const VALID_VERSION_ID = /^[A-Za-z0-9_-]{1,191}$/;

/**
 * Pure, deterministic gate over whether a resident may record consent for
 * HELD to attempt a booking on a proposal version. Records a fact only --
 * the hardcoded-false fields make outreach, contact, booking, acceptance,
 * payment, capture, dispatch, and completion impossible to represent here.
 * "Not owned," "not ready," "expired," "unavailable," "unsafe," "superseded,"
 * and "not CTA-eligible" all collapse into the same consent_not_allowed
 * outcome deliberately -- the resident-facing/API surface must never reveal
 * which of these is true for a proposal version that isn't theirs.
 */
export function evaluateResidentProposalConsent(input: {
  versionId: string;
  bldgUserId: number | null;
  tenantId: string | null;
  hasExistingConsent: boolean;
  card: ResidentProposalPresentationContract | null;
}): ResidentProposalConsentDecision {
  if (!input.versionId || !VALID_VERSION_ID.test(input.versionId)) {
    return result("invalid_request", ["malformed_version_id"]);
  }
  if (!input.bldgUserId || input.bldgUserId <= 0) {
    return result("invalid_request", ["missing_bldg_user_id"]);
  }
  if (!input.tenantId) {
    return result("invalid_request", ["missing_tenant_id"]);
  }

  if (input.hasExistingConsent) {
    return result("consent_already_recorded", ["idempotent_replay"]);
  }

  if (!input.card) {
    return result("consent_not_allowed", ["proposal_not_owned_or_not_eligible"]);
  }
  if (input.card.readiness !== "ready_for_resident") {
    return result("consent_not_allowed", [`proposal_readiness:${input.card.readiness}`]);
  }
  if (!input.card.cta.visible) {
    return result("consent_not_allowed", ["proposal_not_cta_eligible"]);
  }

  return result("consent_recorded", ["eligible"]);
}
