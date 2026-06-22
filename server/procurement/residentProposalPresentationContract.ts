import type { VendorReputationEvidenceRow } from "./vendorEvidenceResolverPolicy";
import { resolveCandidateEvidence } from "./vendorEvidenceResolverPolicy";
import { evaluateVendorReputationEvidence } from "./vendorReputationEvidencePolicy";
import type { AdminProposalVersionPreview } from "./vendorProposalReviewStore";

export const RESIDENT_PROPOSAL_READINESS_STATES = [
  "ready_for_resident", "expired", "unavailable", "not_ready", "unsafe",
] as const;
export type ResidentProposalReadiness = (typeof RESIDENT_PROPOSAL_READINESS_STATES)[number];

export type ResidentProposalPresentationInput = {
  proposal: AdminProposalVersionPreview;
  selectedEvidenceRows: readonly VendorReputationEvidenceRow[];
  now: Date;
};

export type ResidentProposalPresentationContract = {
  proposal_id: string;
  proposal_version_id: string;
  service_category: string;
  service_label: string;
  resident_safe_summary: string;
  vendor_display_name: string;
  vendor_source_display_type: string | null;
  offered_window: { start: string; end: string; label: string } | null;
  quoted_price: { amount_cents: number; currency: string; label: string } | null;
  proposal_expiry: string;
  readiness: ResidentProposalReadiness;
  truth_language: {
    availability: "Available, not booked" | null;
    authority: "Approve HELD to try to book";
    disclaimer: "Nothing is confirmed until provider acceptance is verified";
  };
  truth_flags: {
    available_not_booked: boolean;
    provider_not_accepted: true;
    not_paid: true;
    not_dispatched: true;
    not_completed: true;
  };
  fit: { sentence: string } | null;
  reputation: { summary: string; source_display_type: string } | null;
  evidence_labels: string[];
  cta: {
    visible: boolean;
    primary_text: "Let HELD try to book this";
    reassurance: "Nothing is confirmed until the provider accepts.";
    authority_only: true;
  };
  state_mutated: false;
  llm_called: false;
};

const UNSAFE_SUMMARY_CLAIMS = /\b(booked|booking confirmed|provider accepted|paid|dispatched|completed|guaranteed)\b/i;

function sourceDisplayType(row: VendorReputationEvidenceRow | null): string | null {
  if (!row) return null;
  if (row.sourceType === "public_business_directory") return "Public business directory";
  if (row.sourceType === "manual_operator_list") return "Operator-curated source";
  if (row.sourceType === "permitted_public_fetch") return "Permitted public source";
  return "Approved public source";
}

function readiness(input: ResidentProposalPresentationInput, evidenceUsable: boolean): ResidentProposalReadiness {
  const proposal = input.proposal;
  if (proposal.expired || proposal.expiresAt.getTime() <= input.now.getTime()
      || (proposal.terms.expiresAt && proposal.terms.expiresAt.getTime() <= input.now.getTime())) return "expired";
  if (proposal.reviewState === "superseded") return "not_ready";
  if (proposal.readiness === "unsafe" || !evidenceUsable
      || proposal.truth.providerAccepted !== false || proposal.truth.paid !== false
      || proposal.truth.dispatched !== false || proposal.truth.completed !== false) return "unsafe";
  if (proposal.terms.availabilityStatus !== "available"
      || proposal.truth.availability !== "available_not_booked"
      || proposal.terms.availabilityWindows.length === 0) return "unavailable";
  if (proposal.proposalStatus !== "ready_for_resident_presentation"
      || proposal.readiness !== "ready_for_admin_review") return "not_ready";
  return "ready_for_resident";
}

function safeSummary(proposal: AdminProposalVersionPreview): string {
  const candidate = proposal.jobCard.displaySummary?.trim();
  if (candidate && !UNSAFE_SUMMARY_CLAIMS.test(candidate)) return candidate;
  return `${proposal.jobCard.serviceLabel || proposal.candidate.category} request`;
}

function price(proposal: AdminProposalVersionPreview) {
  if (proposal.terms.rateStatus !== "provided" || proposal.terms.quotedAmountCents === null) return null;
  const currency = proposal.terms.quotedCurrency || "USD";
  return { amount_cents: proposal.terms.quotedAmountCents, currency,
    label: `Quoted ${new Intl.NumberFormat("en-US", { style: "currency", currency }).format(proposal.terms.quotedAmountCents / 100)}` };
}

function offeredWindow(proposal: AdminProposalVersionPreview) {
  if (proposal.terms.availabilityStatus !== "available" || !proposal.terms.availabilityWindows[0]) return null;
  const window = proposal.terms.availabilityWindows[0];
  return { start: window.start, end: window.end,
    label: `${new Date(window.start).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })}–${new Date(window.end).toLocaleTimeString("en-US", { timeStyle: "short", timeZone: "UTC" })}` };
}

/** Pure narrowing projection. No storage, API, UI, external call, or mutation. */
export function buildResidentProposalPresentation(
  input: ResidentProposalPresentationInput,
): ResidentProposalPresentationContract {
  const selectedIds = new Set(input.proposal.evidenceReferences.map(reference => reference.evidenceSnapshotId));
  const selectedRows = input.selectedEvidenceRows.filter(row => row.candidateId === input.proposal.candidate.id
    && selectedIds.has(row.id));
  const allReferencesResolved = selectedIds.size > 0 && selectedIds.size === new Set(selectedRows.map(row => row.id)).size;
  const usableRows = selectedRows.filter(row => evaluateVendorReputationEvidence(row, input.now).status === "usable"
    && (row.sourceConfidence === "trusted" || row.sourceConfidence === "medium"));
  const evidenceUsable = allReferencesResolved && usableRows.length === selectedRows.length;
  const state = readiness(input, evidenceUsable);

  const reputationIds = new Set(input.proposal.evidenceReferences
    .filter(reference => reference.evidenceRole === "reputation").map(reference => reference.evidenceSnapshotId));
  const reputationRows = usableRows.filter(row => reputationIds.has(row.id));
  const resolvedReputation = resolveCandidateEvidence(input.proposal.candidate.id, reputationRows, input.now);
  const reputationRow = reputationRows.find(row => row.id === resolvedReputation.selectedEvidenceId) ?? null;
  const reputation = reputationRow && reputationRow.rating !== null && reputationRow.reviewCount !== null
    ? { summary: `${reputationRow.rating} out of ${reputationRow.ratingScaleMax} across ${reputationRow.reviewCount} public reviews`,
      source_display_type: sourceDisplayType(reputationRow)! } : null;

  const fitIds = new Set(input.proposal.fit.evidenceIds);
  const fitEvidenceCurrent = fitIds.size > 0 && Array.from(fitIds).every(id => usableRows.some(row => row.id === id));
  const fit = input.proposal.fit.safeToDisplay && input.proposal.fit.displaySentence && fitEvidenceCurrent
    && !UNSAFE_SUMMARY_CLAIMS.test(input.proposal.fit.displaySentence)
    ? { sentence: input.proposal.fit.displaySentence } : null;
  const window = offeredWindow(input.proposal);
  const quotedPrice = price(input.proposal);
  const ctaVisible = state === "ready_for_resident" && window !== null;
  const roleLabels = new Set<string>();
  for (const reference of input.proposal.evidenceReferences) {
    if (!usableRows.some(row => row.id === reference.evidenceSnapshotId)) continue;
    if (reference.evidenceRole === "eligibility") roleLabels.add("Vendor eligibility");
    if (reference.evidenceRole === "reputation") roleLabels.add("Public reputation");
    if (reference.evidenceRole === "request_fit") roleLabels.add("Request fit");
  }
  return {
    proposal_id: input.proposal.proposalId,
    proposal_version_id: input.proposal.versionId,
    service_category: input.proposal.jobCard.category || input.proposal.candidate.category,
    service_label: input.proposal.jobCard.serviceLabel || input.proposal.candidate.category,
    resident_safe_summary: safeSummary(input.proposal),
    vendor_display_name: input.proposal.candidate.businessName,
    vendor_source_display_type: sourceDisplayType(usableRows[0] ?? null),
    offered_window: window,
    quoted_price: quotedPrice,
    proposal_expiry: input.proposal.expiresAt.toISOString(),
    readiness: state,
    truth_language: { availability: window ? "Available, not booked" : null, authority: "Approve HELD to try to book",
      disclaimer: "Nothing is confirmed until provider acceptance is verified" },
    truth_flags: { available_not_booked: window !== null && input.proposal.truth.availability === "available_not_booked",
      provider_not_accepted: true, not_paid: true, not_dispatched: true, not_completed: true },
    fit,
    reputation,
    evidence_labels: Array.from(roleLabels),
    cta: { visible: ctaVisible, primary_text: "Let HELD try to book this",
      reassurance: "Nothing is confirmed until the provider accepts.", authority_only: true },
    state_mutated: false,
    llm_called: false,
  };
}
