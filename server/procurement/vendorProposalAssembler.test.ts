import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { buildRequestJobCard } from "./requestJobCardPolicy";
import type { VendorOptionEligibilityDecision } from "./vendorOptionEligibilityPolicy";
import type { RequestSpecificFitDecision } from "./requestSpecificFitEvidencePolicy";
import type { VendorReputationEvidenceRow } from "./vendorEvidenceResolverPolicy";
import { assembleVendorProposal, VendorProposalAssembler, type VendorProposalAssemblyInput } from "./vendorProposalAssembler";

const NOW = new Date("2026-06-22T12:00:00.000Z");

function evidence(patch: Partial<VendorReputationEvidenceRow> = {}): VendorReputationEvidenceRow {
  return { id: "evidence-1", candidateId: "candidate-1", sourceType: "public_business_directory",
    sourceKey: "google_business_profiles", evidenceStatus: "usable", rating: 4.8, ratingScaleMin: 0,
    ratingScaleMax: 5, reviewCount: 100, sourceConfidence: "trusted", sourceApproved: true,
    observedAt: new Date("2026-06-20T00:00:00.000Z"), expiresAt: new Date("2026-06-25T00:00:00.000Z"),
    evidencePayload: {}, complianceSnapshot: {}, ...patch };
}

function input(): VendorProposalAssemblyInput {
  const jobCard = buildRequestJobCard({ serviceIntent: "dog_grooming", rawRequest: "Groom Theo Friday",
    residentContext: { buildingSlug: "the-wright" }, facts: { buildingSlug: "the-wright",
      requestedDate: "2026-06-26", dog: { name: "Theo", breed: "Poodle" } },
    source: { sourceType: "service_request", sourceId: "12" }, now: NOW });
  const eligibilityDecision: VendorOptionEligibilityDecision = {
    eligibility_status: "eligible_for_internal_review", readiness_reasons: [],
    truth_flags: { available_not_booked: true, not_provider_accepted: true, not_paid: true,
      not_dispatched: true, not_completed: true, vendor_contacted: true,
      price_confirmed_by_terms: true, resident_proposal_allowed: false },
    candidate_id: "candidate-1", selected_evidence_id: "evidence-1", selected_terms_id: "terms-1",
    quoted_amount_cents: 8500, match_decision: null, proposal_readiness: null, approval_gate: null,
    administrative_only: true, state_mutated: false, llm_called: false,
  };
  const fitDecision: RequestSpecificFitDecision = {
    fit_status: "strong_match", fit_basis: { matched_fields: ["breed"], evidence_ids: ["evidence-1"],
      confidence: "high", safe_to_display: true,
      display_sentence: "I found explicit relevant evidence for poodle, which fits Theo’s request.",
      admin_explanation: "Exact breed evidence.", reason_codes: ["exact_breed_evidence"] },
    administrative_only: true, state_mutated: false, llm_called: false,
  };
  return {
    proposalId: "proposal-1", versionId: "version-1", workflowId: null, candidateId: "candidate-1",
    jobCard, eligibilityDecision, fitDecision,
    responseTerms: { id: "terms-1", candidateId: "candidate-1", interpretationStatus: "interpreted",
      availabilityStatus: "available", rateStatus: "provided", quotedAmount: 85, quotedCurrency: "USD",
      rateUnit: "service", availabilityWindowsJson: [{ start: "2026-06-26T09:00:00.000Z", end: "2026-06-26T17:00:00.000Z" }],
      confidence: "high", observedAt: NOW, expiresAt: new Date("2026-06-26T00:00:00.000Z") },
    evidenceRows: [evidence()], selectedReputationEvidenceIds: ["evidence-1"],
    constraints: { maximumBudgetCents: 10000, scheduledAt: new Date("2026-06-26T12:00:00.000Z") },
    auditMetadata: { assembledByPolicy: "vendor-proposal-assembler-v1" }, createdBy: "operator-1", now: NOW,
  };
}

describe("vendor proposal assembler", () => {
  it("assembles factual storage input with fixed truth language and evidence roles", () => {
    const result = assembleVendorProposal(input());
    expect(result.status).toBe("proposal_assembled");
    expect(result.jobCardSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.storageInput?.truthFlags).toEqual({ availability_state: "available_not_booked",
      quoted_price_state: "quoted_not_final", booked: false, provider_accepted: false,
      paid: false, dispatched: false, completed: false });
    expect(result.storageInput?.residentTruthInputs).toEqual({ availability_label: "Available, not booked",
      approval_cta: "Approve HELD to try to book",
      confirmation_disclaimer: "Nothing is confirmed until provider acceptance is verified" });
    expect(result.storageInput?.evidenceReferences).toEqual([
      { evidenceSnapshotId: "evidence-1", evidenceRole: "eligibility" },
      { evidenceSnapshotId: "evidence-1", evidenceRole: "reputation" },
      { evidenceSnapshotId: "evidence-1", evidenceRole: "request_fit" },
    ]);
  });

  it("creates proposals and incremented versions only through proposal storage", async () => {
    const storage = { createProposal: vi.fn(async () => ({ proposalId: "proposal-1", versionId: "version-1", version: 1 as const })),
      createNextVersion: vi.fn(async () => ({ proposalId: "proposal-1", versionId: "version-2", version: 2 })) };
    const assembler = new VendorProposalAssembler(storage);
    expect((await assembler.createProposal(input())).stored?.version).toBe(1);
    const next = input(); next.versionId = "version-2";
    expect((await assembler.createNextVersion(next)).stored?.version).toBe(2);
    expect(storage.createProposal).toHaveBeenCalledOnce();
    expect(storage.createNextVersion).toHaveBeenCalledOnce();
  });

  it("blocks incomplete job cards and ineligible vendor options before storage", async () => {
    const incomplete = input();
    incomplete.jobCard = buildRequestJobCard({ serviceIntent: "dog_grooming", rawRequest: "Dog grooming",
      facts: {}, source: { sourceType: "manual", sourceId: "1" }, now: NOW });
    expect(assembleVendorProposal(incomplete).reasonCodes).toContain("job_card_incomplete_or_unsafe");
    const ineligible = input(); ineligible.eligibilityDecision = { ...ineligible.eligibilityDecision, eligibility_status: "ineligible" };
    expect(assembleVendorProposal(ineligible).reasonCodes).toContain("vendor_option_not_presentable");
  });

  it.each([
    ["missing", { id: undefined }],
    ["expired", { expiresAt: new Date("2026-06-21T00:00:00.000Z") }],
    ["unclear", { availabilityStatus: "needs_clarification" }],
    ["unavailable", { availabilityStatus: "unavailable" }],
    ["missing price", { rateStatus: "not_provided", quotedAmount: null }],
  ] as const)("blocks %s response terms", (_label, patch) => {
    const value = input(); value.responseTerms = { ...value.responseTerms, ...patch } as typeof value.responseTerms;
    expect(assembleVendorProposal(value).allowed).toBe(false);
  });

  it("blocks missing evidence IDs and unsafe fit decisions", () => {
    const missing = input(); missing.evidenceRows = [];
    expect(assembleVendorProposal(missing).reasonCodes).toContain("evidence_reference_missing");
    const unsafe = input(); unsafe.fitDecision = { ...unsafe.fitDecision, fit_status: "unsafe_to_display",
      fit_basis: { ...unsafe.fitDecision.fit_basis, safe_to_display: false, display_sentence: null } };
    expect(assembleVendorProposal(unsafe).reasonCodes).toContain("fit_decision_unsafe");
  });

  it.each(["booked", "providerAccepted", "paid", "dispatched", "completed"])("blocks attempted %s truth", key => {
    const value = input(); value.requestedTruthClaims = { [key]: true };
    expect(assembleVendorProposal(value).reasonCodes.some(code => code.startsWith("forbidden_truth_claim:"))).toBe(true);
  });

  it("bounds proposal expiry by both terms and evidence", () => {
    const evidenceBound = input();
    expect(assembleVendorProposal(evidenceBound).storageInput?.expiresAt.toISOString()).toBe("2026-06-25T00:00:00.000Z");
    const requested = input(); requested.requestedExpiresAt = new Date("2026-06-24T00:00:00.000Z");
    expect(assembleVendorProposal(requested).storageInput?.expiresAt.toISOString()).toBe("2026-06-24T00:00:00.000Z");
  });

  it("does not call storage when assembly is blocked", async () => {
    const storage = { createProposal: vi.fn(), createNextVersion: vi.fn() };
    const value = input(); value.requestedTruthClaims = { booked: true };
    const result = await new VendorProposalAssembler(storage).createProposal(value);
    expect(result.stored).toBeNull();
    expect(storage.createProposal).not.toHaveBeenCalled();
  });

  it("contains no SQL, external calls, LLM, outreach, payment, or dispatch integration", () => {
    const source = readFileSync("server/procurement/vendorProposalAssembler.ts", "utf8");
    expect(source).not.toMatch(/INSERT|UPDATE|DELETE|fetch\(|axios|anthropic|openai|sendSMS|sendEmail|stripe/i);
    expect(source).toContain("llmCalled: false");
    expect(source).not.toContain("vendorProposalVersionStore.ts");
  });
});
