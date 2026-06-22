import { createHash } from "node:crypto";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import type { RequestJobCard } from "./requestJobCardPolicy";
import type { RequestSpecificFitDecision } from "./requestSpecificFitEvidencePolicy";
import type { VendorOptionEligibilityDecision } from "./vendorOptionEligibilityPolicy";

export type ProposalEvidenceRole = "eligibility" | "reputation" | "request_fit";
export type ProposalReviewState = "draft" | "needs_operator_review" | "ready_for_admin_review";

export type ProposalEvidenceReference = {
  evidenceSnapshotId: string;
  evidenceRole: ProposalEvidenceRole;
};

export type ProposalTruthFlags = {
  availability_state: "available_not_booked";
  quoted_price_state: "quoted_not_final";
  booked: false;
  provider_accepted: false;
  paid: false;
  dispatched: false;
  completed: false;
};

export type ResidentProposalTruthInputs = {
  availability_label: "Available, not booked";
  approval_cta: "Approve HELD to try to book";
  confirmation_disclaimer: "Nothing is confirmed until provider acceptance is verified";
};

export type CreateProposalVersionInput = {
  versionId: string;
  responseTermsId: string;
  jobCard: RequestJobCard;
  eligibilityDecision: VendorOptionEligibilityDecision;
  fitDecision: RequestSpecificFitDecision;
  evidenceReferences: ProposalEvidenceReference[];
  truthFlags: ProposalTruthFlags;
  residentTruthInputs: ResidentProposalTruthInputs;
  reviewState: ProposalReviewState;
  expiresAt: Date;
  auditMetadata: Record<string, unknown>;
  createdBy: string;
  now?: Date;
};

export type CreateVendorProposalInput = CreateProposalVersionInput & {
  proposalId: string;
  workflowId: string | null;
  candidateId: string;
  jobCardSourceType: "service_request" | "resident_coordinated_request" | "resident_agent_plan" | "manual";
  jobCardSourceId: string;
};

type ProposalRow = RowDataPacket & { id: string; candidate_id: string };
type TermsRow = RowDataPacket & {
  id: string;
  candidate_id: string;
  availability_status: string;
  rate_status: string;
  quoted_amount: string | null;
  expires_at: Date | null;
};
type EvidenceRow = RowDataPacket & {
  id: string;
  evidence_status: string;
  source_approved: number | boolean;
  source_confidence: string;
  observed_at: Date;
  expires_at: Date;
};

const FORBIDDEN_TRUE_KEYS = new Set([
  "booked", "provideraccepted", "accepted", "paid", "captured", "dispatched", "completed",
  "selectedforexecution", "paymentauthorized", "paymentcaptured", "invoicecreated", "payablecreated",
]);
const FORBIDDEN_RAW_REVIEW_KEYS = new Set(["rawreviewtext", "scrapedreviewtext", "reviewbody", "reviewtext"]);

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[_\-\s]/g, "");
}

function unsafeSnapshotFields(value: unknown, path = "input"): string[] {
  if (!value || typeof value !== "object") return [];
  const reasons: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = normalizedKey(key);
    if (FORBIDDEN_TRUE_KEYS.has(normalized) && child === true) reasons.push(`forbidden_truth_claim:${path}.${key}`);
    if (FORBIDDEN_RAW_REVIEW_KEYS.has(normalized)) reasons.push(`raw_review_text_forbidden:${path}.${key}`);
    reasons.push(...unsafeSnapshotFields(child, `${path}.${key}`));
  }
  return reasons;
}

function stableJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? JSON.stringify(value.toISOString()) : "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined && typeof child !== "function" && typeof child !== "symbol")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return "null";
  return JSON.stringify(value) ?? "null";
}

export function proposalJobCardSnapshotHash(jobCard: RequestJobCard): string {
  return createHash("sha256").update(stableJson(jobCard)).digest("hex");
}

export function validateProposalVersionInput(input: CreateProposalVersionInput): string[] {
  const reasons: string[] = [];
  if (!input.versionId.trim() || !input.responseTermsId.trim() || !input.createdBy.trim()) reasons.push("required_identity_missing");
  if (!Number.isFinite(input.expiresAt.getTime()) || input.expiresAt.getTime() <= (input.now ?? new Date()).getTime()) {
    reasons.push("proposal_expiry_invalid_or_elapsed");
  }
  if (input.jobCard.status !== "job_card_ready_for_admin_review" || !input.jobCard.jobCardAllowed) {
    reasons.push("job_card_not_ready_for_proposal");
  }
  if (input.eligibilityDecision.eligibility_status !== "eligible_for_internal_review") {
    reasons.push("vendor_option_not_eligible");
  }
  if (input.eligibilityDecision.selected_terms_id !== input.responseTermsId) reasons.push("response_terms_reference_mismatch");
  if (input.eligibilityDecision.truth_flags.available_not_booked !== true) reasons.push("availability_not_supported_by_eligibility");
  if (input.eligibilityDecision.truth_flags.price_confirmed_by_terms !== true) reasons.push("quoted_price_not_supported_by_eligibility");
  if (input.fitDecision.fit_status === "unsafe_to_display" || !input.fitDecision.fit_basis.safe_to_display) {
    reasons.push("fit_decision_not_safe_to_preserve_for_display");
  }
  const evidenceIds = new Set(input.evidenceReferences.map(reference => reference.evidenceSnapshotId));
  if (!input.evidenceReferences.length || input.evidenceReferences.some(reference => !reference.evidenceSnapshotId.trim())) {
    reasons.push("evidence_references_missing");
  }
  if (input.eligibilityDecision.selected_evidence_id
      && !evidenceIds.has(input.eligibilityDecision.selected_evidence_id)) {
    reasons.push("eligibility_evidence_reference_missing");
  }
  for (const id of input.fitDecision.fit_basis.evidence_ids) {
    if (!evidenceIds.has(id)) reasons.push("fit_evidence_reference_missing");
  }
  if (input.truthFlags.availability_state !== "available_not_booked"
      || input.truthFlags.quoted_price_state !== "quoted_not_final"
      || input.truthFlags.booked !== false || input.truthFlags.provider_accepted !== false
      || input.truthFlags.paid !== false || input.truthFlags.dispatched !== false
      || input.truthFlags.completed !== false) reasons.push("proposal_truth_flags_invalid");
  if (input.residentTruthInputs.availability_label !== "Available, not booked"
      || input.residentTruthInputs.approval_cta !== "Approve HELD to try to book"
      || input.residentTruthInputs.confirmation_disclaimer !== "Nothing is confirmed until provider acceptance is verified") {
    reasons.push("resident_truth_language_invalid");
  }
  reasons.push(...unsafeSnapshotFields({
    jobCard: input.jobCard,
    eligibilityDecision: input.eligibilityDecision,
    fitDecision: input.fitDecision,
    auditMetadata: input.auditMetadata,
  }));
  return Array.from(new Set(reasons));
}

/**
 * Raw persistence boundary for already-evaluated proposal snapshots. It does
 * not assemble proposals or advance review, outreach, booking, payment, or dispatch.
 */
export class VendorProposalVersionStore {
  constructor(private readonly pool: Pool) {}

  async createProposal(input: CreateVendorProposalInput): Promise<{ proposalId: string; versionId: string; version: 1 }> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      this.assertLocallyValid(input);
      await this.assertWorkflowExists(connection, input.workflowId);
      await this.assertCandidateExists(connection, input.candidateId);
      const terms = await this.readTerms(connection, input.responseTermsId);
      await this.assertUpstreamReferences(connection, input, input.candidateId, terms);
      await connection.execute(
        `INSERT INTO vendor_proposals
          (id, workflow_id, candidate_id, job_card_source_type, job_card_source_id, proposal_status, created_by)
         VALUES (?, ?, ?, ?, ?, 'draft', ?)`,
        [input.proposalId, input.workflowId, input.candidateId, input.jobCardSourceType,
         input.jobCardSourceId, input.createdBy],
      );
      await this.insertVersion(connection, input.proposalId, 1, input);
      await connection.commit();
      return { proposalId: input.proposalId, versionId: input.versionId, version: 1 };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async createNextVersion(input: CreateProposalVersionInput & { proposalId: string }): Promise<{
    proposalId: string; versionId: string; version: number;
  }> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      this.assertLocallyValid(input);
      const proposal = await this.lockProposal(connection, input.proposalId);
      const terms = await this.readTerms(connection, input.responseTermsId);
      await this.assertUpstreamReferences(connection, input, proposal.candidate_id, terms);
      const [versionRows] = await connection.execute<RowDataPacket[]>(
        `SELECT COALESCE(MAX(version), 0) AS current_version
           FROM vendor_proposal_versions WHERE proposal_id = ?`, [input.proposalId],
      );
      const nextVersion = Number(versionRows[0]?.current_version ?? 0) + 1;
      await this.insertVersion(connection, input.proposalId, nextVersion, input);
      await connection.commit();
      return { proposalId: input.proposalId, versionId: input.versionId, version: nextVersion };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private assertLocallyValid(input: CreateProposalVersionInput): void {
    const reasons = validateProposalVersionInput(input);
    if (reasons.length) throw new Error(`Proposal version is not safe to store: ${reasons.join(",")}`);
  }

  private async insertVersion(connection: PoolConnection, proposalId: string, version: number,
    input: CreateProposalVersionInput): Promise<void> {
    await connection.execute(
      `INSERT INTO vendor_proposal_versions
        (id, proposal_id, version, response_terms_id, job_card_snapshot_json, job_card_snapshot_hash,
         eligibility_decision_json, fit_decision_json, truth_flags_json, resident_truth_inputs_json,
         review_state, expires_at, audit_metadata_json, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.versionId, proposalId, version, input.responseTermsId, stableJson(input.jobCard),
       proposalJobCardSnapshotHash(input.jobCard), stableJson(input.eligibilityDecision),
       stableJson(input.fitDecision), stableJson(input.truthFlags), stableJson(input.residentTruthInputs),
       input.reviewState, input.expiresAt, stableJson(input.auditMetadata), input.createdBy],
    );
    for (const reference of input.evidenceReferences) {
      await connection.execute(
        `INSERT INTO vendor_proposal_version_evidence
          (proposal_version_id, evidence_snapshot_id, evidence_role) VALUES (?, ?, ?)`,
        [input.versionId, reference.evidenceSnapshotId, reference.evidenceRole],
      );
    }
  }

  private async assertUpstreamReferences(connection: PoolConnection, input: CreateProposalVersionInput,
    candidateId: string, terms: TermsRow): Promise<void> {
    if (terms.candidate_id !== candidateId || input.eligibilityDecision.candidate_id !== candidateId) {
      throw new Error("Proposal candidate references do not match");
    }
    if (terms.availability_status !== "available") throw new Error("Response terms do not support availability");
    if (terms.rate_status !== "provided" || terms.quoted_amount === null) throw new Error("Response terms do not support quoted price");
    if (!terms.expires_at || terms.expires_at.getTime() < input.expiresAt.getTime()) {
      throw new Error("Proposal expiry exceeds response terms expiry");
    }
    const ids = Array.from(new Set(input.evidenceReferences.map(reference => reference.evidenceSnapshotId)));
    const [rows] = await connection.query<EvidenceRow[]>(
      `SELECT id, evidence_status, source_approved, source_confidence, observed_at, expires_at
         FROM vendor_reputation_evidence_snapshots
        WHERE candidate_id = ? AND id IN (?) FOR SHARE`,
      [candidateId, ids],
    );
    const evidenceIsCurrent = rows.every(row => row.evidence_status === "usable"
      && !!row.source_approved
      && (row.source_confidence === "trusted" || row.source_confidence === "medium")
      && row.observed_at.getTime() <= (input.now ?? new Date()).getTime()
      && row.expires_at.getTime() >= input.expiresAt.getTime());
    if (new Set(rows.map(row => String(row.id))).size !== ids.length || !evidenceIsCurrent) {
      throw new Error("Proposal evidence references are missing, unusable, or belong to another candidate");
    }
  }

  private async readTerms(connection: PoolConnection, id: string): Promise<TermsRow> {
    const [rows] = await connection.execute<TermsRow[]>(
      `SELECT id, candidate_id, availability_status, rate_status, quoted_amount, expires_at
         FROM vendor_response_terms WHERE id = ? FOR SHARE`, [id],
    );
    if (!rows[0]) throw new Error("Vendor response terms not found");
    return rows[0];
  }

  private async lockProposal(connection: PoolConnection, id: string): Promise<ProposalRow> {
    const [rows] = await connection.execute<ProposalRow[]>(
      `SELECT id, candidate_id FROM vendor_proposals WHERE id = ? FOR UPDATE`, [id],
    );
    if (!rows[0]) throw new Error("Vendor proposal not found");
    return rows[0];
  }

  private async assertCandidateExists(connection: PoolConnection, id: string): Promise<void> {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM vendor_sourcing_candidates WHERE id = ? FOR SHARE`, [id],
    );
    if (!rows[0]) throw new Error("Vendor sourcing candidate not found");
  }

  private async assertWorkflowExists(connection: PoolConnection, id: string | null): Promise<void> {
    if (id === null) return;
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM procurement_workflows WHERE id = ? FOR SHARE`, [id],
    );
    if (!rows[0]) throw new Error("Procurement workflow not found");
  }
}
