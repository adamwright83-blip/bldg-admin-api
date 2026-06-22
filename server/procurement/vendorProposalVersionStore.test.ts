import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Pool } from "mysql2/promise";
import { buildRequestJobCard } from "./requestJobCardPolicy";
import type { RequestSpecificFitDecision } from "./requestSpecificFitEvidencePolicy";
import type { VendorOptionEligibilityDecision } from "./vendorOptionEligibilityPolicy";
import {
  proposalJobCardSnapshotHash,
  validateProposalVersionInput,
  VendorProposalVersionStore,
  type CreateProposalVersionInput,
  type CreateVendorProposalInput,
} from "./vendorProposalVersionStore";

const NOW = new Date("2026-06-22T12:00:00.000Z");

function versionInput(): CreateProposalVersionInput {
  const jobCard = buildRequestJobCard({
    serviceIntent: "dog_grooming", rawRequest: "Groom Theo Friday",
    residentContext: { buildingSlug: "the-wright", unit: "4B" },
    facts: { buildingSlug: "the-wright", requestedDate: "2026-06-26", dog: { name: "Theo", breed: "Poodle" } },
    source: { sourceType: "service_request", sourceId: "12" }, now: NOW,
  });
  const eligibilityDecision: VendorOptionEligibilityDecision = {
    eligibility_status: "eligible_for_internal_review",
    readiness_reasons: [{ code: "eligible_for_internal_review", explanation: "Internal review only." }],
    truth_flags: { available_not_booked: true, not_provider_accepted: true, not_paid: true,
      not_dispatched: true, not_completed: true, vendor_contacted: true,
      price_confirmed_by_terms: true, resident_proposal_allowed: false },
    candidate_id: "candidate-1", selected_evidence_id: "evidence-1", selected_terms_id: "terms-1",
    quoted_amount_cents: 8500, match_decision: null, proposal_readiness: null, approval_gate: null,
    administrative_only: true, state_mutated: false, llm_called: false,
  };
  const fitDecision: RequestSpecificFitDecision = {
    fit_status: "strong_match",
    fit_basis: { matched_fields: ["breed"], evidence_ids: ["evidence-1"], confidence: "high",
      safe_to_display: true, display_sentence: "I found explicit relevant evidence for poodle, which fits Theo’s request.",
      admin_explanation: "Exact breed evidence.", reason_codes: ["exact_breed_evidence"] },
    administrative_only: true, state_mutated: false, llm_called: false,
  };
  return {
    versionId: "version-1", responseTermsId: "terms-1", jobCard, eligibilityDecision, fitDecision,
    evidenceReferences: [{ evidenceSnapshotId: "evidence-1", evidenceRole: "request_fit" }],
    truthFlags: { availability_state: "available_not_booked", quoted_price_state: "quoted_not_final",
      booked: false, provider_accepted: false, paid: false, dispatched: false, completed: false },
    residentTruthInputs: { availability_label: "Available, not booked",
      approval_cta: "Approve HELD to try to book",
      confirmation_disclaimer: "Nothing is confirmed until provider acceptance is verified" },
    reviewState: "ready_for_admin_review", expiresAt: new Date("2026-06-25T12:00:00.000Z"),
    auditMetadata: { policyVersion: "request-specific-fit-v1", evaluatedAt: NOW.toISOString() },
    createdBy: "operator-1", now: NOW,
  };
}

function poolForStore(currentVersion = 0, evidenceExpiresAt = new Date("2026-06-26T12:00:00.000Z")) {
  const execute = vi.fn(async (sql: string) => {
    if (sql.includes("FROM vendor_proposals WHERE")) return [[{ id: "proposal-1", candidate_id: "candidate-1" }], []];
    if (sql.includes("FROM vendor_response_terms")) return [[{
      id: "terms-1", candidate_id: "candidate-1", availability_status: "available",
      rate_status: "provided", quoted_amount: "85.00", expires_at: new Date("2026-06-26T12:00:00.000Z"),
    }], []];
    if (sql.includes("MAX(version)")) return [[{ current_version: currentVersion }], []];
    if (sql.includes("FROM vendor_sourcing_candidates")) return [[{ id: "candidate-1" }], []];
    return [{ affectedRows: 1 }, []];
  });
  const query = vi.fn(async () => [[{ id: "evidence-1", evidence_status: "usable", source_approved: 1,
    source_confidence: "trusted", observed_at: new Date("2026-06-20T12:00:00.000Z"),
    expires_at: evidenceExpiresAt }], []]);
  const connection = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute, query };
  return { pool: { getConnection: vi.fn(async () => connection) } as unknown as Pool, connection };
}

describe("durable vendor proposal/version storage", () => {
  it("validates factual inputs and hashes canonical job cards deterministically", () => {
    const input = versionInput();
    expect(validateProposalVersionInput(input)).toEqual([]);
    expect(proposalJobCardSnapshotHash(input.jobCard)).toMatch(/^[a-f0-9]{64}$/);
    expect(proposalJobCardSnapshotHash(input.jobCard)).toBe(proposalJobCardSnapshotHash({ ...input.jobCard }));
  });

  it("preserves initial proposal, version, terms, evidence, fit, eligibility, and truth snapshots", async () => {
    const { pool, connection } = poolForStore();
    const store = new VendorProposalVersionStore(pool);
    const result = await store.createProposal({ ...versionInput(), proposalId: "proposal-1", workflowId: null,
      candidateId: "candidate-1", jobCardSourceType: "service_request", jobCardSourceId: "12" });
    expect(result).toEqual({ proposalId: "proposal-1", versionId: "version-1", version: 1 });
    const sql = connection.execute.mock.calls.map(call => String(call[0])).join("\n");
    expect(sql).toContain("INSERT INTO vendor_proposals");
    expect(sql).toContain("INSERT INTO vendor_proposal_versions");
    expect(sql).toContain("INSERT INTO vendor_proposal_version_evidence");
    const versionCall = connection.execute.mock.calls.find(call => String(call[0]).includes("INSERT INTO vendor_proposal_versions"));
    expect(JSON.stringify(versionCall?.[1])).toContain("exact_breed_evidence");
    expect(JSON.stringify(versionCall?.[1])).toContain("eligible_for_internal_review");
    expect(JSON.stringify(versionCall?.[1])).toContain("Approve HELD to try to book");
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it("locks the proposal and allocates monotonically increasing versions", async () => {
    const { pool, connection } = poolForStore(3);
    const result = await new VendorProposalVersionStore(pool).createNextVersion({
      ...versionInput(), proposalId: "proposal-1", versionId: "version-4",
    });
    expect(result.version).toBe(4);
    expect(connection.execute.mock.calls.some(call => String(call[0]).includes("FOR UPDATE"))).toBe(true);
    const versionCall = connection.execute.mock.calls.find(call => String(call[0]).includes("INSERT INTO vendor_proposal_versions"));
    expect(versionCall?.[1]?.[2]).toBe(4);
  });

  it("fails closed for missing evidence references, unsafe fit, elapsed expiry, or unsupported truth", () => {
    const missingEvidence = versionInput();
    missingEvidence.evidenceReferences = [];
    expect(validateProposalVersionInput(missingEvidence)).toEqual(expect.arrayContaining([
      "evidence_references_missing", "eligibility_evidence_reference_missing", "fit_evidence_reference_missing",
    ]));

    const unsafeFit = versionInput();
    unsafeFit.fitDecision = { ...unsafeFit.fitDecision, fit_status: "unsafe_to_display",
      fit_basis: { ...unsafeFit.fitDecision.fit_basis, safe_to_display: false, display_sentence: null } };
    expect(validateProposalVersionInput(unsafeFit)).toContain("fit_decision_not_safe_to_preserve_for_display");

    const expired = versionInput();
    expired.expiresAt = new Date("2026-06-21T12:00:00.000Z");
    expect(validateProposalVersionInput(expired)).toContain("proposal_expiry_invalid_or_elapsed");

    const falseTruth = versionInput();
    falseTruth.truthFlags = { ...falseTruth.truthFlags, booked: true as false };
    expect(validateProposalVersionInput(falseTruth)).toContain("proposal_truth_flags_invalid");
  });

  it("rejects raw review text and unsupported outcome claims in audit snapshots", () => {
    const rawReview = versionInput();
    rawReview.auditMetadata = { rawReviewText: "copied review" };
    expect(validateProposalVersionInput(rawReview).some(reason => reason.startsWith("raw_review_text_forbidden"))).toBe(true);
    const booked = versionInput();
    booked.auditMetadata = { booked: true };
    expect(validateProposalVersionInput(booked).some(reason => reason.startsWith("forbidden_truth_claim"))).toBe(true);
  });

  it("rolls back before writes when local truth validation fails", async () => {
    const { pool, connection } = poolForStore();
    const bad = { ...versionInput(), proposalId: "proposal-1", workflowId: null, candidateId: "candidate-1",
      jobCardSourceType: "service_request" as const, jobCardSourceId: "12" };
    bad.residentTruthInputs = { ...bad.residentTruthInputs, approval_cta: "Booking confirmed" as never };
    await expect(new VendorProposalVersionStore(pool).createProposal(bad)).rejects.toThrow("resident_truth_language_invalid");
    expect(connection.execute).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it("does not let a proposal version outlive its supporting evidence", async () => {
    const { pool, connection } = poolForStore(0, new Date("2026-06-24T12:00:00.000Z"));
    await expect(new VendorProposalVersionStore(pool).createProposal({
      ...versionInput(), proposalId: "proposal-1", workflowId: null, candidateId: "candidate-1",
      jobCardSourceType: "service_request", jobCardSourceId: "12",
    })).rejects.toThrow("evidence references are missing, unusable");
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it("writes only the three new proposal tables and performs no external or execution behavior", () => {
    const source = readFileSync("server/procurement/vendorProposalVersionStore.ts", "utf8");
    const inserts = [...source.matchAll(/INSERT INTO ([a-z_]+)/g)].map(match => match[1]);
    expect(new Set(inserts)).toEqual(new Set([
      "vendor_proposals", "vendor_proposal_versions", "vendor_proposal_version_evidence",
    ]));
    expect(source).not.toMatch(/fetch\(|axios|stripe|sendSMS|sendEmail|capturePayment/i);
  });
});

describe("proposal storage migration", () => {
  it("is additive, versioned, evidence-linked, and contains no execution columns or seed rows", () => {
    const sql = readFileSync("procurement/migrations/0015_vendor_proposal_versions.sql", "utf8");
    expect(sql.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(3);
    expect(sql).toContain("UNIQUE KEY `uq_vendor_proposal_versions_proposal_version`");
    expect(sql).toContain("REFERENCES `vendor_reputation_evidence_snapshots`");
    expect(sql).toContain("REFERENCES `vendor_response_terms`");
    expect(sql).not.toMatch(/ALTER TABLE|DROP TABLE|TRUNCATE|\bINSERT INTO\b/);
    expect(sql).not.toMatch(/`(booked|provider_accepted|paid|dispatched|completed)`/);
  });
});
