import { renderVendorOutreachDraft, type DraftRenderingDecision } from "./vendorOutreachDraftingPolicy";
import type { LegalDocumentPolicyView, LintRulePolicyView, OutreachTemplatePolicyView } from "./legalTemplatePolicy";

export const POST_CONSENT_OUTREACH_TEMPLATE_KEY = "vendor_availability_request_v0";
export const POST_CONSENT_OUTREACH_TEMPLATE_VERSION = "v1";
const FOUNDER_ESCALATION_LINE_SUBSTRING = "speak to held founder directly";

export function containsFounderEscalationLine(text: string): boolean {
  return text.toLocaleLowerCase("en-US").includes(FOUNDER_ESCALATION_LINE_SUBSTRING);
}

export type PostConsentActionPlanStatus =
  | "draft_vendor_outreach"
  | "needs_resident_clarification"
  | "needs_operator_review"
  | "blocked_expired"
  | "blocked_missing_vendor_contact"
  | "blocked_terms_changed"
  | "blocked_unsafe_to_contact"
  | "invalid_request";

export type PostConsentActionPlanDecision = {
  status: PostConsentActionPlanStatus;
  allowed: boolean;
  reasons: string[];
  eligibleForAutoSendPilot: false;
  outreachSent: false;
  vendorContacted: false;
  booked: false;
  accepted: false;
  paid: false;
  captured: false;
  dispatched: false;
  completed: false;
  llmCalled: false;
  draftRendering: DraftRenderingDecision | null;
};

type ProposalSnapshot = {
  proposalId: string;
  expired: boolean;
  readiness: "ready_for_admin_review" | "not_ready" | "unsafe" | "expired" | "superseded";
  jobCardReference: { snapshotHash: string };
  jobCard: { category: string | null; serviceLabel: string | null; requestFacts: Record<string, unknown> };
  candidate: { id: string; businessName: string; category: string };
};

function result(input: {
  status: PostConsentActionPlanStatus; allowed?: boolean; reasons: string[];
  draftRendering?: DraftRenderingDecision | null;
}): PostConsentActionPlanDecision {
  return {
    status: input.status, allowed: input.allowed ?? input.status === "draft_vendor_outreach",
    reasons: Array.from(new Set(input.reasons)), eligibleForAutoSendPilot: false,
    outreachSent: false, vendorContacted: false, booked: false, accepted: false,
    paid: false, captured: false, dispatched: false, completed: false, llmCalled: false,
    draftRendering: input.draftRendering ?? null,
  };
}

/**
 * Pure, deterministic planner that runs after a resident's consent is
 * durably recorded. Decides the single safest next step -- it never sends,
 * contacts, books, pays, dispatches, or completes anything itself. When it
 * decides drafting is safe, it renders the draft via the existing template
 * lint/approval pipeline (renderVendorOutreachDraft) -- it never bypasses
 * that pipeline, and a template/lint failure always routes to a human
 * outcome rather than producing an unsafe draft.
 */
export function evaluatePostConsentActionPlan(input: {
  consentProposalVersionSnapshotHash: string;
  proposal: ProposalSnapshot | null;
  vendorContact: { hasUsableChannel: boolean };
  candidateSourcingStatus: string;
  template: OutreachTemplatePolicyView | null;
  legalDocument: LegalDocumentPolicyView | null;
  lintRules: LintRulePolicyView[];
  variables: Record<string, string | number | boolean>;
  now?: Date;
}): PostConsentActionPlanDecision {
  if (!input.consentProposalVersionSnapshotHash) {
    return result({ status: "invalid_request", reasons: ["missing_consent_snapshot_hash"] });
  }

  if (!input.proposal) {
    return result({ status: "blocked_terms_changed", reasons: ["proposal_version_not_found"] });
  }
  const proposal = input.proposal;

  if (proposal.jobCardReference.snapshotHash !== input.consentProposalVersionSnapshotHash) {
    return result({ status: "blocked_terms_changed", reasons: ["proposal_snapshot_hash_mismatch"] });
  }
  if (proposal.expired || proposal.readiness === "expired") {
    return result({ status: "blocked_expired", reasons: ["proposal_expired"] });
  }
  if (proposal.readiness === "superseded") {
    return result({ status: "blocked_terms_changed", reasons: ["proposal_superseded"] });
  }
  if (proposal.readiness === "unsafe" || proposal.readiness === "not_ready") {
    return result({ status: "needs_operator_review", reasons: [`proposal_readiness:${proposal.readiness}`] });
  }
  if (!input.vendorContact.hasUsableChannel) {
    return result({ status: "blocked_missing_vendor_contact", reasons: ["vendor_contact_channel_unavailable"] });
  }
  if (Object.keys(proposal.jobCard.requestFacts).length === 0) {
    return result({ status: "needs_resident_clarification", reasons: ["request_facts_missing"] });
  }

  const rendering = renderVendorOutreachDraft({
    candidateStatus: input.candidateSourcingStatus, template: input.template,
    legalDocument: input.legalDocument, lintRules: input.lintRules, variables: input.variables, now: input.now,
  });

  if (!rendering.allowed) {
    if (rendering.reasons.includes("candidate_not_approved_for_outreach")
      || rendering.reasons.includes("rendered_draft_lint_blocked")) {
      return result({ status: "blocked_unsafe_to_contact", reasons: rendering.reasons, draftRendering: rendering });
    }
    if (rendering.reasons.includes("render_variables_missing")) {
      return result({ status: "needs_resident_clarification", reasons: rendering.reasons, draftRendering: rendering });
    }
    return result({ status: "needs_operator_review", reasons: rendering.reasons, draftRendering: rendering });
  }

  return result({ status: "draft_vendor_outreach", reasons: ["eligible"], draftRendering: rendering });
}
