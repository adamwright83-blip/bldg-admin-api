import { describe, expect, it } from "vitest";
import {
  canProduceCandidateEvidence,
  evaluateSourceConnectorCompliance,
  type SourceConnectorComplianceInput,
} from "./sourceConnectorCompliancePolicy";

const source = (
  patch: Partial<SourceConnectorComplianceInput> = {},
): SourceConnectorComplianceInput => ({
  sourceKey: "google_business_profiles",
  reviewStatus: "proposed",
  legalApprovalArtifact: null,
  accessDescription: null,
  ...patch,
});

describe("source connector compliance policy", () => {
  it("fails closed for unknown sources", () => {
    const decision = evaluateSourceConnectorCompliance(source({ sourceKey: "mystery_directory" }));
    expect(decision).toEqual({
      knownSource: false,
      productionAllowed: false,
      candidateEvidenceAllowed: false,
      quarantined: true,
      reasons: ["unknown_source"],
    });
  });

  it.each(["google_business_profiles", "yelp_business_directory"])(
    "permits %s only as a non-enabled review model",
    sourceKey => {
      for (const reviewStatus of ["proposed", "needs_legal_review", "disabled"] as const) {
        const decision = evaluateSourceConnectorCompliance(source({ sourceKey, reviewStatus }));
        expect(decision.productionAllowed).toBe(false);
        expect(decision.candidateEvidenceAllowed).toBe(false);
      }
      const approved = evaluateSourceConnectorCompliance(source({ sourceKey, reviewStatus: "approved" }));
      expect(approved.productionAllowed).toBe(false);
      expect(approved.reasons).toContain("business_source_cannot_be_enabled");
    },
  );

  it("prevents proposed sources from producing candidate evidence", () => {
    expect(canProduceCandidateEvidence(source({ reviewStatus: "proposed" }))).toBe(false);
  });

  it("prevents prohibited sources from any production use", () => {
    const decision = evaluateSourceConnectorCompliance(source({ reviewStatus: "prohibited" }));
    expect(decision.productionAllowed).toBe(false);
    expect(decision.candidateEvidenceAllowed).toBe(false);
    expect(decision.reasons).toContain("source_prohibited");
  });

  it("quarantines Reddit without a valid legal approval artifact", () => {
    const missing = evaluateSourceConnectorCompliance(source({ sourceKey: "reddit", reviewStatus: "approved" }));
    expect(missing.quarantined).toBe(true);
    expect(missing.reasons).toContain("reddit_quarantined_pending_legal_approval");

    const malformed = evaluateSourceConnectorCompliance(source({
      sourceKey: "reddit",
      reviewStatus: "approved",
      legalApprovalArtifact: {
        artifactId: "",
        approvedAt: new Date("invalid"),
        approvedBy: "",
        scope: "candidate_evidence",
      },
    }));
    expect(malformed.productionAllowed).toBe(false);
  });

  it("models a later explicitly approved Reddit artifact without granting other sources permission", () => {
    const decision = evaluateSourceConnectorCompliance(source({
      sourceKey: "reddit",
      reviewStatus: "approved",
      legalApprovalArtifact: {
        artifactId: "legal-review-123",
        approvedAt: new Date("2026-06-19T00:00:00.000Z"),
        approvedBy: "legal-operator",
        scope: "candidate_evidence",
      },
    }));
    expect(decision).toMatchObject({ productionAllowed: true, candidateEvidenceAllowed: true, quarantined: false });
  });

  it("does not treat scraping language as permission", () => {
    const decision = evaluateSourceConnectorCompliance(source({
      reviewStatus: "proposed",
      accessDescription: "scraping is permitted by this free-form note",
    }));
    expect(decision.productionAllowed).toBe(false);
    expect(decision.candidateEvidenceAllowed).toBe(false);
  });
});
