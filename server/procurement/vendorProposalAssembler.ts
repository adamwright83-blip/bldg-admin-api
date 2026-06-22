import type { RequestJobCard } from "./requestJobCardPolicy";
import type { RequestSpecificFitDecision } from "./requestSpecificFitEvidencePolicy";
import { evaluateVendorReputationEvidence } from "./vendorReputationEvidencePolicy";
import type { VendorReputationEvidenceRow } from "./vendorEvidenceResolverPolicy";
import type { VendorOptionEligibilityDecision } from "./vendorOptionEligibilityPolicy";
import { buildVendorProposal, type VendorResponseTermsSnapshot } from "./vendorProposalBuilderPolicy";
import {
  VendorProposalVersionStore,
  proposalJobCardSnapshotHash,
  validateProposalVersionInput,
  type CreateProposalVersionInput,
  type CreateVendorProposalInput,
  type ProposalEvidenceReference,
} from "./vendorProposalVersionStore";

export type VendorProposalAssemblyInput = {
  proposalId: string;
  versionId: string;
  workflowId: string | null;
  candidateId: string;
  jobCard: RequestJobCard;
  eligibilityDecision: VendorOptionEligibilityDecision;
  fitDecision: RequestSpecificFitDecision;
  responseTerms: VendorResponseTermsSnapshot;
  evidenceRows: readonly VendorReputationEvidenceRow[];
  selectedReputationEvidenceIds: readonly string[];
  constraints: { maximumBudgetCents: number; scheduledAt: Date };
  requestedExpiresAt?: Date | null;
  requestedTruthClaims?: Record<string, unknown> | null;
  auditMetadata: Record<string, unknown>;
  createdBy: string;
  now: Date;
};

export type VendorProposalAssemblyDecision = {
  status: "proposal_assembled" | "proposal_assembly_blocked";
  allowed: boolean;
  reasonCodes: string[];
  adminExplanation: string;
  proposalId: string;
  versionId: string;
  jobCardSnapshotHash: string | null;
  storageInput: CreateVendorProposalInput | null;
  stateMutated: false;
  llmCalled: false;
};

export type VendorProposalAssemblyStorage = Pick<VendorProposalVersionStore, "createProposal" | "createNextVersion">;

const REASON_EXPLANATIONS: Record<string, string> = {
  assembly_identity_missing: "Proposal, version, candidate, source, or operator identity is missing.",
  job_card_incomplete_or_unsafe: "The canonical job card is incomplete or unsafe.",
  vendor_option_not_presentable: "The Slice 49 vendor option is not eligible for internal review.",
  candidate_reference_mismatch: "Candidate references do not agree across proposal inputs.",
  response_terms_missing: "Real vendor response terms are missing.",
  response_terms_reference_mismatch: "The selected response terms do not match the eligibility decision.",
  response_terms_expired: "The vendor response terms are expired.",
  response_terms_unclear_or_unavailable: "The vendor response terms do not support clear availability and price.",
  response_terms_do_not_satisfy_constraints: "The terms conflict with budget or timing constraints.",
  evidence_ids_missing: "Required evidence IDs are missing.",
  evidence_reference_missing: "A selected evidence ID does not resolve to the candidate.",
  evidence_not_usable: "Selected evidence is stale, unapproved, blocked, or too low confidence.",
  fit_decision_unsafe: "The request-specific fit decision is unsafe to display.",
  fit_evidence_reference_missing: "The fit decision references evidence that was not selected.",
  eligibility_evidence_reference_missing: "The eligibility decision references evidence that was not selected.",
  proposal_expiry_invalid: "No positive proposal validity window remains.",
  forbidden_truth_claim: "The assembly request attempted to assert downstream execution truth.",
  storage_input_invalid: "The assembled storage snapshot failed the durable store contract.",
};

const FORBIDDEN_TRUTH_KEYS = new Set([
  "booked", "provideraccepted", "accepted", "paid", "captured", "dispatched", "completed",
  "paymentauthorized", "paymentcaptured", "selectedforexecution", "invoicecreated", "payablecreated",
]);

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[_\-\s]/g, "");
}

function forbiddenTruthClaims(value: unknown, path = "requestedTruthClaims"): string[] {
  if (!value || typeof value !== "object") return [];
  const reasons: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_TRUTH_KEYS.has(normalizeKey(key)) && child === true) reasons.push(`forbidden_truth_claim:${path}.${key}`);
    reasons.push(...forbiddenTruthClaims(child, `${path}.${key}`));
  }
  return reasons;
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function blocked(input: VendorProposalAssemblyInput, reasons: string[]): VendorProposalAssemblyDecision {
  const codes = unique(reasons);
  return {
    status: "proposal_assembly_blocked", allowed: false, reasonCodes: codes,
    adminExplanation: codes.map(code => REASON_EXPLANATIONS[code.split(":")[0]] ?? code).join(" "),
    proposalId: input.proposalId, versionId: input.versionId, jobCardSnapshotHash: null,
    storageInput: null, stateMutated: false, llmCalled: false,
  };
}

function sourceType(card: RequestJobCard): CreateVendorProposalInput["jobCardSourceType"] {
  if (card.source.sourceType === "coordinated_request") return "resident_coordinated_request";
  if (card.source.sourceType === "resident_agent_plan") return "resident_agent_plan";
  if (card.source.sourceType === "service_request") return "service_request";
  return "manual";
}

function evidenceReferences(input: VendorProposalAssemblyInput): ProposalEvidenceReference[] {
  const references: ProposalEvidenceReference[] = [];
  if (input.eligibilityDecision.selected_evidence_id) {
    references.push({ evidenceSnapshotId: input.eligibilityDecision.selected_evidence_id, evidenceRole: "eligibility" });
  }
  for (const id of input.selectedReputationEvidenceIds) {
    references.push({ evidenceSnapshotId: id, evidenceRole: "reputation" });
  }
  for (const id of input.fitDecision.fit_basis.evidence_ids) {
    references.push({ evidenceSnapshotId: id, evidenceRole: "request_fit" });
  }
  const seen = new Set<string>();
  return references.filter(reference => {
    const key = `${reference.evidenceSnapshotId}:${reference.evidenceRole}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Pure assembly. It performs no I/O and creates no durable record. */
export function assembleVendorProposal(input: VendorProposalAssemblyInput): VendorProposalAssemblyDecision {
  const reasons: string[] = [];
  if (!input.proposalId.trim() || !input.versionId.trim() || !input.candidateId.trim()
      || !input.createdBy.trim() || !input.jobCard.source.sourceId?.trim()) reasons.push("assembly_identity_missing");
  if (input.jobCard.status !== "job_card_ready_for_admin_review" || !input.jobCard.jobCardAllowed) {
    reasons.push("job_card_incomplete_or_unsafe");
  }
  if (input.eligibilityDecision.eligibility_status !== "eligible_for_internal_review") {
    reasons.push("vendor_option_not_presentable");
  }
  if (input.eligibilityDecision.candidate_id !== input.candidateId
      || (input.responseTerms.candidateId ?? input.candidateId) !== input.candidateId) {
    reasons.push("candidate_reference_mismatch");
  }
  if (!input.responseTerms.id) reasons.push("response_terms_missing");
  if (input.eligibilityDecision.selected_terms_id !== input.responseTerms.id) {
    reasons.push("response_terms_reference_mismatch");
  }
  if (input.fitDecision.fit_status === "unsafe_to_display" || !input.fitDecision.fit_basis.safe_to_display) {
    reasons.push("fit_decision_unsafe");
  }
  reasons.push(...forbiddenTruthClaims(input.requestedTruthClaims));

  const termsExpiryValue = input.responseTerms.expiresAt ?? input.responseTerms.expires_at;
  const termsExpiry = termsExpiryValue ? new Date(termsExpiryValue) : null;
  if (!termsExpiry || !Number.isFinite(termsExpiry.getTime()) || termsExpiry.getTime() <= input.now.getTime()) {
    reasons.push("response_terms_expired");
  }

  const references = evidenceReferences(input);
  const requiredIds = unique(references.map(reference => reference.evidenceSnapshotId));
  if (!requiredIds.length) reasons.push("evidence_ids_missing");
  const evidenceById = new Map(input.evidenceRows
    .filter(row => row.candidateId === input.candidateId).map(row => [row.id, row]));
  if (requiredIds.some(id => !evidenceById.has(id))) reasons.push("evidence_reference_missing");
  if (input.eligibilityDecision.selected_evidence_id
      && !requiredIds.includes(input.eligibilityDecision.selected_evidence_id)) {
    reasons.push("eligibility_evidence_reference_missing");
  }
  if (input.fitDecision.fit_basis.evidence_ids.some(id => !requiredIds.includes(id))) {
    reasons.push("fit_evidence_reference_missing");
  }
  const selectedEvidence = requiredIds.map(id => evidenceById.get(id)).filter((row): row is VendorReputationEvidenceRow => !!row);
  if (selectedEvidence.some(row => evaluateVendorReputationEvidence(row, input.now).status !== "usable"
      || (row.sourceConfidence !== "trusted" && row.sourceConfidence !== "medium"))) {
    reasons.push("evidence_not_usable");
  }

  const constraintsValid = Number.isSafeInteger(input.constraints.maximumBudgetCents)
    && input.constraints.maximumBudgetCents >= 0
    && Number.isFinite(input.constraints.scheduledAt.getTime());
  if (!constraintsValid) reasons.push("response_terms_do_not_satisfy_constraints");
  let proposalReadiness = null;
  if (constraintsValid && input.responseTerms.id) {
    proposalReadiness = buildVendorProposal({
      termsList: [input.responseTerms],
      requestContext: { workflowId: input.workflowId, serviceType: input.jobCard.category },
      constraints: { maxPriceCents: input.constraints.maximumBudgetCents, scheduledAt: input.constraints.scheduledAt },
      candidateContext: { candidateId: input.candidateId }, now: input.now,
    });
    if (proposalReadiness.status === "proposal_vendor_declined"
        || proposalReadiness.status === "proposal_needs_clarification"
        || proposalReadiness.status === "proposal_unsupported"
        || proposalReadiness.status === "proposal_not_allowed") {
      reasons.push("response_terms_unclear_or_unavailable");
    } else if (proposalReadiness.status !== "proposal_ready_for_review") {
      reasons.push("response_terms_do_not_satisfy_constraints");
    }
  }

  const evidenceExpiryTimes = selectedEvidence.map(row => row.expiresAt.getTime()).filter(Number.isFinite);
  const maximumExpiry = Math.min(
    termsExpiry?.getTime() ?? Number.NEGATIVE_INFINITY,
    evidenceExpiryTimes.length ? Math.min(...evidenceExpiryTimes) : Number.NEGATIVE_INFINITY,
    input.requestedExpiresAt?.getTime() ?? Number.POSITIVE_INFINITY,
  );
  if (!Number.isFinite(maximumExpiry) || maximumExpiry <= input.now.getTime()) reasons.push("proposal_expiry_invalid");
  if (reasons.length) return blocked(input, reasons);

  const expiresAt = new Date(maximumExpiry);
  const versionInput: CreateProposalVersionInput = {
    versionId: input.versionId,
    responseTermsId: input.responseTerms.id!,
    jobCard: input.jobCard,
    eligibilityDecision: input.eligibilityDecision,
    fitDecision: input.fitDecision,
    evidenceReferences: references,
    truthFlags: { availability_state: "available_not_booked", quoted_price_state: "quoted_not_final",
      booked: false, provider_accepted: false, paid: false, dispatched: false, completed: false },
    residentTruthInputs: { availability_label: "Available, not booked",
      approval_cta: "Approve HELD to try to book",
      confirmation_disclaimer: "Nothing is confirmed until provider acceptance is verified" },
    reviewState: proposalReadiness?.riskFlags.includes("low_confidence_terms")
      ? "needs_operator_review" : "ready_for_admin_review",
    expiresAt,
    auditMetadata: { ...input.auditMetadata,
      assembledAt: input.now.toISOString(), proposalReadinessReasons: proposalReadiness?.reasons ?? [] },
    createdBy: input.createdBy,
    now: input.now,
  };
  const storageReasons = validateProposalVersionInput(versionInput);
  if (storageReasons.length) return blocked(input, ["storage_input_invalid", ...storageReasons]);
  const storageInput: CreateVendorProposalInput = {
    ...versionInput,
    proposalId: input.proposalId,
    workflowId: input.workflowId,
    candidateId: input.candidateId,
    jobCardSourceType: sourceType(input.jobCard),
    jobCardSourceId: input.jobCard.source.sourceId!,
  };
  return {
    status: "proposal_assembled", allowed: true, reasonCodes: [],
    adminExplanation: "Proposal inputs are factual, current, and ready for durable internal-review storage.",
    proposalId: input.proposalId, versionId: input.versionId,
    jobCardSnapshotHash: proposalJobCardSnapshotHash(input.jobCard), storageInput,
    stateMutated: false, llmCalled: false,
  };
}

/** Thin storage orchestration; the only mutation is delegated to proposal storage. */
export class VendorProposalAssembler {
  constructor(private readonly storage: VendorProposalAssemblyStorage) {}

  async createProposal(input: VendorProposalAssemblyInput) {
    const assembly = assembleVendorProposal(input);
    if (!assembly.allowed || !assembly.storageInput) return { assembly, stored: null };
    const stored = await this.storage.createProposal(assembly.storageInput);
    return { assembly, stored };
  }

  async createNextVersion(input: VendorProposalAssemblyInput) {
    const assembly = assembleVendorProposal(input);
    if (!assembly.allowed || !assembly.storageInput) return { assembly, stored: null };
    const { proposalId, workflowId: _workflowId, candidateId: _candidateId,
      jobCardSourceType: _sourceType, jobCardSourceId: _sourceId, ...versionInput } = assembly.storageInput;
    const stored = await this.storage.createNextVersion({ ...versionInput, proposalId });
    return { assembly, stored };
  }
}
