/**
 * Evidence-based autonomy readiness, not an authorization grant.
 *
 * Calling code must still enforce durable operator consent and the established
 * platform action/tenant authority before executing autonomous work. Elapsed
 * calendar days deliberately do not enter these criteria.
 */

export type ClaireAutonomyLevel = 0 | 1 | 2;

export type AutonomyEvidence = {
  tenantId: string;
  operatorUserId: string;
  /** Verified work only; an issued task or generated receipt is not completion. */
  relevantMissionsObserved: number | null;
  relevantMissionsCompleted: number | null;
  verifiedPlanningCycles: number | null;
  /** Real cross-session/replay certification, not an assertion by the model. */
  executionPathCertified: boolean;
  sourceCoverageFresh: boolean;
  correctionAndRevocationTested: boolean;
  criticalOpenDefects: number | null;
  /** Derived from an approved, durable operator authorization record. */
  consent: {
    allowedLevel: ClaireAutonomyLevel;
    revoked: boolean;
    evidenceRef: string | null;
  };
};

export type ClaireAutonomyReadiness = {
  allowedLevel: ClaireAutonomyLevel;
  /** Highest observed eligible level, independently of consent. */
  evidenceCeiling: ClaireAutonomyLevel;
  /** Actual maximum is capped by operator approval. This is NOT an action grant. */
  consentCeiling: ClaireAutonomyLevel;
  reasons: string[];
  evidenceStatus: "sufficient" | "insufficient";
};

function validCount(value: number | null): boolean {
  return value !== null && Number.isInteger(value) && value >= 0;
}

export function evaluateClaireAutonomyReadiness(
  evidence: AutonomyEvidence
): ClaireAutonomyReadiness {
  const reasons: string[] = [];
  const consentCeiling: ClaireAutonomyLevel =
    !evidence.consent.revoked && evidence.consent.evidenceRef?.trim()
      && [0, 1, 2].includes(evidence.consent.allowedLevel) ? evidence.consent.allowedLevel : 0;

  if (!evidence.tenantId.trim() || !evidence.operatorUserId.trim()) {
    reasons.push("unresolved_identity");
  }
  if (!validCount(evidence.relevantMissionsObserved) ||
      !validCount(evidence.relevantMissionsCompleted) ||
      !validCount(evidence.verifiedPlanningCycles) ||
      !validCount(evidence.criticalOpenDefects)) {
    reasons.push("incomplete_or_invalid_evidence");
  }
  if (evidence.relevantMissionsObserved !== null &&
      evidence.relevantMissionsCompleted !== null &&
      evidence.relevantMissionsCompleted > evidence.relevantMissionsObserved) {
    reasons.push("contradictory_mission_evidence");
  }
  if (!evidence.executionPathCertified) reasons.push("execution_path_not_certified");
  if (!evidence.sourceCoverageFresh) reasons.push("business_source_coverage_not_fresh");
  if (!evidence.correctionAndRevocationTested) reasons.push("revocation_not_certified");
  if (evidence.criticalOpenDefects !== 0) reasons.push("unresolved_critical_defects");
  if (evidence.consent.revoked) reasons.push("operator_consent_revoked");
  if (!evidence.consent.evidenceRef?.trim() || evidence.consent.allowedLevel === 0) {
    reasons.push("operator_approval_required");
  }
  if (reasons.some(r => [
    "unresolved_identity", "incomplete_or_invalid_evidence",
    "contradictory_mission_evidence", "execution_path_not_certified",
    "business_source_coverage_not_fresh", "revocation_not_certified",
    "unresolved_critical_defects",
  ].includes(r))) {
    return {
      allowedLevel: 0, evidenceCeiling: 0, consentCeiling,
      reasons, evidenceStatus: "insufficient",
    };
  }

  const observed = evidence.relevantMissionsObserved!;
  const completed = evidence.relevantMissionsCompleted!;
  const cycles = evidence.verifiedPlanningCycles!;
  const rate = observed === 0 ? 0 : completed / observed;

  // These conservative release thresholds are policy defaults for review,
  // not proof that any particular business has achieved readiness.
  const level1 = observed >= 15 && completed >= 12 && rate >= 0.8 && cycles >= 2;
  const level2 = observed >= 40 && completed >= 36 && rate >= 0.9 && cycles >= 6;
  const evidenceCeiling: ClaireAutonomyLevel = level2 ? 2 : level1 ? 1 : 0;
  const allowedLevel = Math.min(evidenceCeiling, consentCeiling) as ClaireAutonomyLevel;
  if (!level1) reasons.push("insufficient_verified_mission_and_planning_history");
  else if (!level2) reasons.push("higher_autonomy_not_yet_demonstrated");
  if (consentCeiling < evidenceCeiling) reasons.push("operator_permission_caps_autonomy");
  return {
    allowedLevel, evidenceCeiling, consentCeiling, reasons,
    evidenceStatus: evidenceCeiling > 0 ? "sufficient" : "insufficient",
  };
}
