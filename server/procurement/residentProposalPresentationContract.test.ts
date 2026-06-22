import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { AdminProposalVersionPreview } from "./vendorProposalReviewStore";
import type { VendorReputationEvidenceRow } from "./vendorEvidenceResolverPolicy";
import { buildResidentProposalPresentation } from "./residentProposalPresentationContract";

const NOW = new Date("2026-06-22T12:00:00.000Z");

function evidence(patch: Partial<VendorReputationEvidenceRow> = {}): VendorReputationEvidenceRow {
  return { id: "evidence-1", candidateId: "candidate-1", sourceType: "public_business_directory",
    sourceKey: "google_business_profiles", evidenceStatus: "usable", rating: 4.8, ratingScaleMin: 0,
    ratingScaleMax: 5, reviewCount: 120, sourceConfidence: "trusted", sourceApproved: true,
    observedAt: new Date("2026-06-20T00:00:00.000Z"), expiresAt: new Date("2026-06-25T00:00:00.000Z"),
    evidencePayload: {}, complianceSnapshot: {}, ...patch };
}

function preview(patch: Partial<AdminProposalVersionPreview> = {}): AdminProposalVersionPreview {
  return {
    proposalId: "proposal-1", proposalStatus: "ready_for_resident_presentation",
    versionId: "version-1", version: 1, reviewState: "ready_for_admin_review",
    expiresAt: new Date("2026-06-24T00:00:00.000Z"), expired: false,
    readiness: "ready_for_admin_review", warnings: [],
    jobCardReference: { sourceType: "service_request", sourceId: "12", snapshotHash: "a".repeat(64) },
    jobCard: { category: "dog_grooming", serviceLabel: "Dog grooming",
      displaySummary: "Dog grooming Friday", residentContext: { residentName: "Adam" },
      requestFacts: { requestedDate: "2026-06-26", dog: { name: "Theo", breed: "Poodle" } } },
    candidate: { id: "candidate-1", businessName: "Theo Grooming", category: "dog_grooming" },
    terms: { id: "terms-1", availabilityStatus: "available", rateStatus: "provided",
      quotedAmountCents: 8500, quotedCurrency: "USD", rateUnit: "service", confidence: "high",
      availabilityWindows: [{ start: "2026-06-26T09:00:00.000Z", end: "2026-06-26T11:00:00.000Z" }],
      observedAt: NOW, expiresAt: new Date("2026-06-24T00:00:00.000Z") },
    evidenceReferences: [
      { evidenceSnapshotId: "evidence-1", evidenceRole: "eligibility" },
      { evidenceSnapshotId: "evidence-1", evidenceRole: "reputation" },
      { evidenceSnapshotId: "evidence-1", evidenceRole: "request_fit" },
    ],
    fit: { status: "strong_match", safeToDisplay: true,
      displaySentence: "I found explicit relevant evidence for poodle, which fits Theo’s request.",
      matchedFields: ["breed"], evidenceIds: ["evidence-1"], confidence: "high",
      reasonCodes: ["exact_breed_evidence"] },
    eligibility: { status: "eligible_for_internal_review", reasonCodes: [], selectedEvidenceId: "evidence-1",
      selectedTermsId: "terms-1", quotedAmountCents: 8500 },
    truth: { availability: "available_not_booked", providerAccepted: false, paid: false,
      dispatched: false, completed: false },
    residentTruthLanguage: { availabilityLabel: "Available, not booked",
      approvalAuthority: "Approve HELD to try to book",
      confirmationDisclaimer: "Nothing is confirmed until provider acceptance is verified" },
    audit: { createdBy: "operator-1", createdAt: NOW }, ...patch,
  };
}

describe("resident proposal-card presentation contract", () => {
  it("builds a ready resident contract with exact truth and CTA language", () => {
    const result = buildResidentProposalPresentation({ proposal: preview(), selectedEvidenceRows: [evidence()], now: NOW });
    expect(result.readiness).toBe("ready_for_resident");
    expect(result.truth_language).toEqual({ availability: "Available, not booked",
      authority: "Approve HELD to try to book",
      disclaimer: "Nothing is confirmed until provider acceptance is verified" });
    expect(result.cta).toEqual({ visible: true, primary_text: "Let HELD try to book this",
      reassurance: "Nothing is confirmed until the provider accepts.", authority_only: true });
    expect(result.truth_flags).toEqual({ available_not_booked: true, provider_not_accepted: true,
      not_paid: true, not_dispatched: true, not_completed: true });
  });

  it("suppresses CTA for expired, superseded, unsafe, and not-ready proposals", () => {
    const cases: Array<[AdminProposalVersionPreview, string]> = [
      [preview({ expired: true }), "expired"],
      [preview({ reviewState: "superseded" }), "not_ready"],
      [preview({ readiness: "unsafe" }), "unsafe"],
      [preview({ proposalStatus: "draft" }), "not_ready"],
    ];
    for (const [proposal, state] of cases) {
      const result = buildResidentProposalPresentation({ proposal, selectedEvidenceRows: [evidence()], now: NOW });
      expect(result.readiness).toBe(state);
      expect(result.cta.visible).toBe(false);
    }
  });

  it("omits unsafe fit sentences and stale evidence copy", () => {
    const unsafeFit = preview({ fit: { ...preview().fit, safeToDisplay: false, displaySentence: "Unsupported claim" } });
    expect(buildResidentProposalPresentation({ proposal: unsafeFit, selectedEvidenceRows: [evidence()], now: NOW }).fit).toBeNull();
    const stale = evidence({ expiresAt: new Date("2026-06-21T00:00:00.000Z") });
    const result = buildResidentProposalPresentation({ proposal: preview(), selectedEvidenceRows: [stale], now: NOW });
    expect(result.readiness).toBe("unsafe");
    expect(result.fit).toBeNull();
    expect(result.reputation).toBeNull();
    expect(result.evidence_labels).toEqual([]);
  });

  it("omits missing price without guessing", () => {
    const value = preview({ terms: { ...preview().terms, rateStatus: "not_provided", quotedAmountCents: null } });
    expect(buildResidentProposalPresentation({ proposal: value, selectedEvidenceRows: [evidence()], now: NOW }).quoted_price).toBeNull();
  });

  it("blocks CTA and available language when availability lacks real terms", () => {
    const value = preview({ terms: { ...preview().terms, availabilityStatus: "unknown", availabilityWindows: [] },
      truth: { ...preview().truth, availability: "availability_not_confirmed" } });
    const result = buildResidentProposalPresentation({ proposal: value, selectedEvidenceRows: [evidence()], now: NOW });
    expect(result.readiness).toBe("unavailable");
    expect(result.offered_window).toBeNull();
    expect(result.truth_language.availability).toBeNull();
    expect(result.cta.visible).toBe(false);
  });

  it("shows public reputation only from selected usable evidence without evidence IDs", () => {
    const result = buildResidentProposalPresentation({ proposal: preview(), selectedEvidenceRows: [evidence()], now: NOW });
    expect(result.reputation).toEqual({ summary: "4.8 out of 5 across 120 public reviews",
      source_display_type: "Public business directory" });
    expect(result.evidence_labels).toEqual(["Vendor eligibility", "Public reputation", "Request fit"]);
    expect(JSON.stringify(result)).not.toContain("evidence-1");
  });

  it("does not expose admin-only or raw fields", () => {
    const result = buildResidentProposalPresentation({ proposal: preview(), selectedEvidenceRows: [evidence()], now: NOW });
    const serialized = JSON.stringify(result);
    for (const field of ["audit", "adminExplanation", "reasonCodes", "warnings", "jobCardSnapshotHash",
      "residentContext", "requestFacts", "rawJson", "evidence_ids"]) expect(serialized).not.toContain(field);
  });

  it("replaces unsafe resident summaries rather than repeating outcome claims", () => {
    const value = preview({ jobCard: { ...preview().jobCard, displaySummary: "Vendor booked and paid" } });
    const result = buildResidentProposalPresentation({ proposal: value, selectedEvidenceRows: [evidence()], now: NOW });
    expect(result.resident_safe_summary).toBe("Dog grooming request");
  });

  it("is deterministic and contains no API, UI, LLM, storage, or mutation behavior", () => {
    const input = { proposal: preview(), selectedEvidenceRows: [evidence()], now: NOW };
    expect(buildResidentProposalPresentation(input)).toEqual(buildResidentProposalPresentation(input));
    const source = readFileSync("server/procurement/residentProposalPresentationContract.ts", "utf8");
    expect(source).not.toMatch(/INSERT|UPDATE|DELETE|fetch\(|axios|anthropic|openai|router|useQuery|useMutation/i);
    expect(source).toContain("state_mutated: false");
    expect(source).toContain("llm_called: false");
  });
});
