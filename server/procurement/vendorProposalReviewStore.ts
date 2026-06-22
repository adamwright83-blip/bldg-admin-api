import type { Pool, RowDataPacket } from "mysql2/promise";

export type AdminProposalEvidenceReference = {
  evidenceSnapshotId: string;
  evidenceRole: "eligibility" | "reputation" | "request_fit";
};

export type AdminProposalVersionPreview = {
  proposalId: string;
  proposalStatus: string;
  versionId: string;
  version: number;
  reviewState: string;
  expiresAt: Date;
  expired: boolean;
  readiness: "ready_for_admin_review" | "not_ready" | "unsafe" | "expired" | "superseded";
  warnings: string[];
  jobCardReference: { sourceType: string; sourceId: string; snapshotHash: string };
  jobCard: {
    category: string | null;
    serviceLabel: string | null;
    displaySummary: string | null;
    residentContext: Record<string, unknown>;
    requestFacts: Record<string, unknown>;
  };
  candidate: { id: string; businessName: string; category: string };
  terms: {
    id: string;
    availabilityStatus: string;
    rateStatus: string;
    quotedAmountCents: number | null;
    quotedCurrency: string | null;
    rateUnit: string | null;
    confidence: string;
    availabilityWindows: Array<{ start: string; end: string }>;
    observedAt: Date;
    expiresAt: Date | null;
  };
  evidenceReferences: AdminProposalEvidenceReference[];
  fit: {
    status: string;
    safeToDisplay: boolean;
    displaySentence: string | null;
    matchedFields: string[];
    evidenceIds: string[];
    confidence: string;
    reasonCodes: string[];
  };
  eligibility: {
    status: string;
    reasonCodes: string[];
    selectedEvidenceId: string | null;
    selectedTermsId: string | null;
    quotedAmountCents: number | null;
  };
  truth: {
    availability: "available_not_booked" | "availability_not_confirmed";
    providerAccepted: false;
    paid: false;
    dispatched: false;
    completed: false;
  };
  residentTruthLanguage: {
    availabilityLabel: "Available, not booked";
    approvalAuthority: "Approve HELD to try to book";
    confirmationDisclaimer: "Nothing is confirmed until provider acceptance is verified";
  };
  audit: { createdBy: string; createdAt: Date };
};

export type AdminProposalVersionPage = {
  items: AdminProposalVersionPreview[];
  page: { limit: number; offset: number; hasMore: boolean };
};

type VersionRow = RowDataPacket & {
  proposal_id: string; proposal_status: string; version_id: string; version: number; review_state: string;
  expires_at: Date; job_card_source_type: string; job_card_source_id: string; job_card_snapshot_json: unknown;
  job_card_snapshot_hash: string; eligibility_decision_json: unknown; fit_decision_json: unknown;
  truth_flags_json: unknown; resident_truth_inputs_json: unknown; created_by: string; created_at: Date;
  candidate_id: string; business_name: string; category: string; response_terms_id: string;
  availability_status: string; rate_status: string; quoted_amount: string | null; quoted_currency: string | null;
  rate_unit: string | null; confidence: string; terms_observed_at: Date; terms_expires_at: Date | null;
  availability_windows_json: unknown;
};
type EvidenceRow = RowDataPacket & { proposal_version_id: string; evidence_snapshot_id: string; evidence_role: AdminProposalEvidenceReference["evidenceRole"] };

function object(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function availabilityWindows(value: unknown): Array<{ start: string; end: string }> {
  const parsed = Array.isArray(value) ? value : typeof value === "string" ? (() => {
    try { const result = JSON.parse(value); return Array.isArray(result) ? result : []; } catch { return []; }
  })() : [];
  return parsed.map(object).map(window => ({ start: text(window.start), end: text(window.end) }))
    .filter((window): window is { start: string; end: string } => !!window.start && !!window.end)
    .filter(window => Number.isFinite(Date.parse(window.start)) && Number.isFinite(Date.parse(window.end)));
}

function mapPreview(row: VersionRow, evidence: AdminProposalEvidenceReference[], now: Date): AdminProposalVersionPreview {
  const card = object(row.job_card_snapshot_json);
  const fitDecision = object(row.fit_decision_json);
  const fitBasis = object(fitDecision.fit_basis);
  const eligibility = object(row.eligibility_decision_json);
  const storedTruth = object(row.truth_flags_json);
  const storedLanguage = object(row.resident_truth_inputs_json);
  const expired = row.expires_at.getTime() <= now.getTime();
  const truthSafe = storedTruth.availability_state === "available_not_booked"
    && storedTruth.booked === false && storedTruth.provider_accepted === false
    && storedTruth.paid === false && storedTruth.dispatched === false && storedTruth.completed === false;
  const languageSafe = storedLanguage.availability_label === "Available, not booked"
    && storedLanguage.approval_cta === "Approve HELD to try to book"
    && storedLanguage.confirmation_disclaimer === "Nothing is confirmed until provider acceptance is verified";
  const fitSafe = fitBasis.safe_to_display === true && fitDecision.fit_status !== "unsafe_to_display";
  const eligibilitySafe = eligibility.eligibility_status === "eligible_for_internal_review";
  const termsExpired = row.terms_expires_at !== null && row.terms_expires_at.getTime() <= now.getTime();
  const termsSafe = row.availability_status === "available" && row.rate_status === "provided"
    && row.quoted_amount !== null && !termsExpired;
  const warnings: string[] = [];
  if (expired) warnings.push("proposal_expired");
  if (row.review_state === "superseded") warnings.push("proposal_superseded");
  if (!truthSafe || !languageSafe) warnings.push("truth_contract_unsafe");
  if (!fitSafe) warnings.push("fit_decision_unsafe");
  if (!eligibilitySafe) warnings.push("eligibility_not_ready");
  if (termsExpired) warnings.push("response_terms_expired");
  else if (!termsSafe) warnings.push("response_terms_not_ready");
  if (row.review_state !== "ready_for_admin_review") warnings.push(`review_state:${row.review_state}`);
  const readiness = expired || termsExpired ? "expired"
    : row.review_state === "superseded" ? "superseded"
    : !truthSafe || !languageSafe || !fitSafe || !eligibilitySafe || !termsSafe ? "unsafe"
    : row.review_state === "ready_for_admin_review" ? "ready_for_admin_review" : "not_ready";
  return {
    proposalId: row.proposal_id, proposalStatus: row.proposal_status,
    versionId: row.version_id, version: Number(row.version), reviewState: row.review_state,
    expiresAt: row.expires_at, expired, readiness, warnings,
    jobCardReference: { sourceType: row.job_card_source_type, sourceId: row.job_card_source_id,
      snapshotHash: row.job_card_snapshot_hash },
    jobCard: { category: text(card.category), serviceLabel: text(card.serviceLabel),
      displaySummary: text(card.displaySummary), residentContext: object(card.residentContext),
      requestFacts: object(card.requestFacts) },
    candidate: { id: row.candidate_id, businessName: row.business_name, category: row.category },
    terms: { id: row.response_terms_id, availabilityStatus: row.availability_status,
      rateStatus: row.rate_status, quotedAmountCents: row.quoted_amount === null ? null : Math.round(Number(row.quoted_amount) * 100),
      quotedCurrency: row.quoted_currency, rateUnit: row.rate_unit, confidence: row.confidence,
      availabilityWindows: availabilityWindows(row.availability_windows_json),
      observedAt: row.terms_observed_at, expiresAt: row.terms_expires_at },
    evidenceReferences: evidence,
    fit: { status: text(fitDecision.fit_status) ?? "unknown", safeToDisplay: fitSafe,
      displaySentence: fitSafe ? text(fitBasis.display_sentence) : null,
      matchedFields: strings(fitBasis.matched_fields), evidenceIds: strings(fitBasis.evidence_ids),
      confidence: text(fitBasis.confidence) ?? "none", reasonCodes: strings(fitBasis.reason_codes) },
    eligibility: { status: text(eligibility.eligibility_status) ?? "unknown",
      reasonCodes: Array.isArray(eligibility.readiness_reasons)
        ? eligibility.readiness_reasons.map(item => text(object(item).code)).filter((item): item is string => !!item) : [],
      selectedEvidenceId: text(eligibility.selected_evidence_id), selectedTermsId: text(eligibility.selected_terms_id),
      quotedAmountCents: number(eligibility.quoted_amount_cents) },
    truth: { availability: termsSafe && truthSafe ? "available_not_booked" : "availability_not_confirmed",
      providerAccepted: false, paid: false, dispatched: false, completed: false },
    residentTruthLanguage: { availabilityLabel: "Available, not booked",
      approvalAuthority: "Approve HELD to try to book",
      confirmationDisclaimer: "Nothing is confirmed until provider acceptance is verified" },
    audit: { createdBy: row.created_by, createdAt: row.created_at },
  };
}

const BASE_SELECT = `SELECT p.id AS proposal_id, p.proposal_status, p.job_card_source_type, p.job_card_source_id,
  v.id AS version_id, v.version, v.review_state, v.expires_at, v.job_card_snapshot_json,
  v.job_card_snapshot_hash, v.eligibility_decision_json, v.fit_decision_json, v.truth_flags_json,
  v.resident_truth_inputs_json, v.created_by, v.created_at,
  c.id AS candidate_id, c.business_name, c.category,
  t.id AS response_terms_id, t.availability_status, t.rate_status, t.quoted_amount,
  t.quoted_currency, t.rate_unit, t.confidence, t.availability_windows_json, t.observed_at AS terms_observed_at,
  t.expires_at AS terms_expires_at
 FROM vendor_proposal_versions v
 JOIN vendor_proposals p ON p.id = v.proposal_id
 JOIN vendor_sourcing_candidates c ON c.id = p.candidate_id
 JOIN vendor_response_terms t ON t.id = v.response_terms_id`;

/** Read-only safe projection; raw stored JSON never leaves this class. */
export class VendorProposalReviewStore {
  constructor(private readonly pool: Pool) {}

  async listVersions(input: { limit: number; offset: number; now?: Date }): Promise<AdminProposalVersionPage> {
    const limit = Math.max(1, Math.min(50, Math.trunc(input.limit)));
    const offset = Math.max(0, Math.min(1000, Math.trunc(input.offset)));
    const [rows] = await this.pool.execute<VersionRow[]>(
      `${BASE_SELECT} ORDER BY v.created_at DESC, v.id ASC LIMIT ? OFFSET ?`, [limit + 1, offset],
    );
    const selected = rows.slice(0, limit);
    const evidence = await this.readEvidence(selected.map(row => row.version_id));
    return { items: selected.map(row => mapPreview(row, evidence.get(row.version_id) ?? [], input.now ?? new Date())),
      page: { limit, offset, hasMore: rows.length > limit } };
  }

  async getVersion(versionId: string, now = new Date()): Promise<AdminProposalVersionPreview | null> {
    const [rows] = await this.pool.execute<VersionRow[]>(`${BASE_SELECT} WHERE v.id = ? LIMIT 1`, [versionId]);
    if (!rows[0]) return null;
    const evidence = await this.readEvidence([versionId]);
    return mapPreview(rows[0], evidence.get(versionId) ?? [], now);
  }

  private async readEvidence(versionIds: string[]): Promise<Map<string, AdminProposalEvidenceReference[]>> {
    const result = new Map<string, AdminProposalEvidenceReference[]>();
    if (!versionIds.length) return result;
    const [rows] = await this.pool.query<EvidenceRow[]>(
      `SELECT proposal_version_id, evidence_snapshot_id, evidence_role
         FROM vendor_proposal_version_evidence
        WHERE proposal_version_id IN (?) ORDER BY evidence_role, evidence_snapshot_id`, [versionIds],
    );
    for (const row of rows) {
      const list = result.get(row.proposal_version_id) ?? [];
      list.push({ evidenceSnapshotId: row.evidence_snapshot_id, evidenceRole: row.evidence_role });
      result.set(row.proposal_version_id, list);
    }
    return result;
  }
}
