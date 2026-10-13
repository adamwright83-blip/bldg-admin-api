import { describe, expect, it } from "vitest";
import { evaluateClaireAutonomyReadiness, type AutonomyEvidence } from "./earnedAutonomyReadiness";

const sample = (overrides: Partial<AutonomyEvidence> = {}): AutonomyEvidence => ({
  tenantId: "tenant_1", operatorUserId: "operator_1",
  relevantMissionsObserved: 40, relevantMissionsCompleted: 38,
  verifiedPlanningCycles: 8, executionPathCertified: true,
  sourceCoverageFresh: true, correctionAndRevocationTested: true,
  criticalOpenDefects: 0,
  consent: { allowedLevel: 2, revoked: false, evidenceRef: "approved:autonomy:2" },
  ...overrides,
});

describe("earned Claire autonomy", () => {
  it("allows level 2 only with verified outcomes, fresh data, certification, and consent", () => {
    expect(evaluateClaireAutonomyReadiness(sample())).toMatchObject({
      allowedLevel: 2, evidenceCeiling: 2, consentCeiling: 2, evidenceStatus: "sufficient",
    });
  });
  it("caps achieved readiness to the operator-approved level", () => {
    expect(evaluateClaireAutonomyReadiness(sample({
      consent: { allowedLevel: 1, revoked: false, evidenceRef: "approved:autonomy:1" },
    })).allowedLevel).toBe(1);
  });
  it("does not grant autonomy after elapsed time or with no completed missions", () => {
    expect(evaluateClaireAutonomyReadiness(sample({
      relevantMissionsObserved: 0, relevantMissionsCompleted: 0,
    })).allowedLevel).toBe(0);
  });
  it("revocation removes eligibility immediately", () => {
    expect(evaluateClaireAutonomyReadiness(sample({
      consent: { allowedLevel: 2, revoked: true, evidenceRef: "revocation:3" },
    })).allowedLevel).toBe(0);
  });
  it("rejects fabricated, missing, or contradictory evidence", () => {
    expect(evaluateClaireAutonomyReadiness(sample({ relevantMissionsCompleted: 42 })).allowedLevel).toBe(0);
    expect(evaluateClaireAutonomyReadiness(sample({ relevantMissionsObserved: null })).allowedLevel).toBe(0);
    expect(evaluateClaireAutonomyReadiness(sample({ criticalOpenDefects: 1 })).allowedLevel).toBe(0);
  });
  it("fails closed if business data or execution path is not certified", () => {
    expect(evaluateClaireAutonomyReadiness(sample({ sourceCoverageFresh: false })).allowedLevel).toBe(0);
    expect(evaluateClaireAutonomyReadiness(sample({ executionPathCertified: false })).allowedLevel).toBe(0);
    expect(evaluateClaireAutonomyReadiness(sample({ correctionAndRevocationTested: false })).allowedLevel).toBe(0);
  });
  it("never manufactures operator consent", () => {
    expect(evaluateClaireAutonomyReadiness(sample({
      consent: { allowedLevel: 2, revoked: false, evidenceRef: null },
    })).allowedLevel).toBe(0);
  });
  it("qualifies for limited planning autonomy before advanced autonomy", () => {
    const v=evaluateClaireAutonomyReadiness(sample({
      relevantMissionsObserved: 20, relevantMissionsCompleted: 17, verifiedPlanningCycles: 3,
    }));
    expect(v.evidenceCeiling).toBe(1);
    expect(v.allowedLevel).toBe(1);
  });
});
