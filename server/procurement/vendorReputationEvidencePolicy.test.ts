import { describe, expect, it } from "vitest";
import {
  evaluateVendorReputationEvidence,
  resolvePersistedEvidenceStatus,
  toVendorEvidenceSnapshot,
  type VendorReputationEvidenceSnapshotView,
} from "./vendorReputationEvidencePolicy";

const NOW = new Date("2026-06-19T12:00:00.000Z");

const snapshot = (
  patch: Partial<VendorReputationEvidenceSnapshotView> = {},
): VendorReputationEvidenceSnapshotView => ({
  candidateId: "candidate-1",
  sourceType: "public_business_directory",
  sourceKey: "google_business_profiles",
  evidenceStatus: "usable",
  rating: 4.7,
  ratingScaleMin: 0,
  ratingScaleMax: 5,
  reviewCount: 120,
  sourceConfidence: "trusted",
  sourceApproved: true,
  observedAt: new Date("2026-06-01T00:00:00.000Z"),
  expiresAt: new Date("2026-07-01T00:00:00.000Z"),
  evidencePayload: { businessName: "Acme Dog Grooming" },
  complianceSnapshot: {},
  ...patch,
});

describe("vendor reputation evidence policy", () => {
  it("accepts a valid trusted, fresh, approved snapshot as usable and convertible", () => {
    const decision = evaluateVendorReputationEvidence(snapshot(), NOW);
    expect(decision).toEqual({ status: "usable", reasons: [] });
    expect(toVendorEvidenceSnapshot(snapshot(), NOW)).toEqual({
      sourceKey: "google_business_profiles", sourceApproved: true, sourceConfidence: 1,
      observedAt: "2026-06-01T00:00:00.000Z", expiresAt: "2026-07-01T00:00:00.000Z",
    });
  });

  it("rejects expired evidence", () => {
    const decision = evaluateVendorReputationEvidence(
      snapshot({ expiresAt: new Date("2026-06-10T00:00:00.000Z") }), NOW,
    );
    expect(decision.status).not.toBe("usable");
    expect(decision.reasons).toContain("evidence_expired");
    expect(toVendorEvidenceSnapshot(snapshot({ expiresAt: new Date("2026-06-10T00:00:00.000Z") }), NOW)).toBeNull();
  });

  it("rejects source_approved=false", () => {
    const decision = evaluateVendorReputationEvidence(snapshot({ sourceApproved: false }), NOW);
    expect(decision.status).not.toBe("usable");
    expect(decision.reasons).toContain("source_not_approved");
  });

  it("rejects source_confidence=untrusted as quarantined", () => {
    const decision = evaluateVendorReputationEvidence(snapshot({ sourceConfidence: "untrusted" }), NOW);
    expect(decision).toEqual({ status: "quarantined", reasons: ["source_confidence_untrusted"] });
  });

  it("rejects evidence_status quarantined and rejected", () => {
    expect(evaluateVendorReputationEvidence(snapshot({ evidenceStatus: "quarantined" }), NOW).status)
      .toBe("quarantined");
    expect(evaluateVendorReputationEvidence(snapshot({ evidenceStatus: "rejected" }), NOW).status)
      .toBe("blocked");
  });

  it("rejects rating outside the declared scale", () => {
    const decision = evaluateVendorReputationEvidence(snapshot({ rating: 5.5 }), NOW);
    expect(decision.status).toBe("blocked");
    expect(decision.reasons).toContain("rating_out_of_scale");
  });

  it("rejects an invalid review count", () => {
    const decision = evaluateVendorReputationEvidence(snapshot({ reviewCount: -1 }), NOW);
    expect(decision.status).toBe("blocked");
    expect(decision.reasons).toContain("review_count_invalid");
  });

  it("rejects protected or proxy fields inside the evidence payload", () => {
    const decision = evaluateVendorReputationEvidence(
      snapshot({ evidencePayload: { zip_code: "90210" } }), NOW,
    );
    expect(decision.status).toBe("blocked");
    expect(decision.reasons[0]).toContain("protected_or_proxy_field");
  });

  it("never treats Reddit evidence as usable without a valid legal approval artifact", () => {
    const withoutApproval = evaluateVendorReputationEvidence(snapshot({ sourceKey: "reddit" }), NOW);
    expect(withoutApproval).toEqual({ status: "quarantined", reasons: ["reddit_quarantined_pending_legal_approval"] });

    const withMalformedApproval = evaluateVendorReputationEvidence(snapshot({
      sourceKey: "reddit",
      complianceSnapshot: { legalApprovalArtifact: { artifactId: "", approvedBy: "", scope: "candidate_evidence", approvedAt: new Date("invalid") } },
    }), NOW);
    expect(withMalformedApproval.status).toBe("quarantined");

    const withValidApproval = evaluateVendorReputationEvidence(snapshot({
      sourceKey: "reddit",
      complianceSnapshot: {
        legalApprovalArtifact: {
          artifactId: "legal-review-123", approvedBy: "legal-operator", scope: "candidate_evidence",
          approvedAt: new Date("2026-06-01T00:00:00.000Z"),
        },
      },
    }), NOW);
    expect(withValidApproval.status).toBe("usable");
  });

  it("rejects malformed timestamps and missing identity", () => {
    expect(evaluateVendorReputationEvidence(snapshot({ candidateId: "" }), NOW).status).toBe("blocked");
    expect(evaluateVendorReputationEvidence(
      snapshot({ observedAt: new Date("2026-07-15T00:00:00.000Z") }), NOW,
    ).status).toBe("blocked");
    expect(evaluateVendorReputationEvidence(
      snapshot({ expiresAt: snapshot().observedAt }), NOW,
    ).status).toBe("blocked");
  });

  it("toVendorEvidenceSnapshot only ever returns a value for usable evidence", () => {
    for (const patch of [{ sourceApproved: false }, { sourceConfidence: "untrusted" as const },
      { evidenceStatus: "quarantined" as const }, { rating: 9 }, { sourceKey: "reddit" }]) {
      expect(toVendorEvidenceSnapshot(snapshot(patch), NOW)).toBeNull();
    }
  });
});

describe("resolvePersistedEvidenceStatus", () => {
  it("maps each decision status to its corresponding db evidence_status", () => {
    expect(resolvePersistedEvidenceStatus({ status: "usable", reasons: [] })).toBe("usable");
    expect(resolvePersistedEvidenceStatus({ status: "quarantined", reasons: [] })).toBe("quarantined");
    expect(resolvePersistedEvidenceStatus({ status: "blocked", reasons: [] })).toBe("rejected");
    expect(resolvePersistedEvidenceStatus({ status: "needs_review", reasons: [] })).toBe("recorded");
  });
});
