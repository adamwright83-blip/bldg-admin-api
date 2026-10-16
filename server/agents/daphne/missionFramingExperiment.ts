/**
 * Read-only, consent-gated proposal and Micro-Randomized Trial (MRT) bridge
 * for testing fantasy immersion and throttling intervention fatigue.
 *
 * A skip is evidence of noncompletion, not proof of the reason. This service
 * cannot change the real work objective, initiate a call, change game canon,
 * or authorize mission execution. Only already-approved presentation variants
 * may be suggested; a separate authorized system must activate them.
 */

import { randomInt as cryptoRandomInt } from "node:crypto";
import {
  drawEqualProbabilityArm,
  isValidAssignmentProbability,
  presentationDecisionPointId,
} from "../../../shared/behavioralExperimentAssignment";
import { STANDARD_PRESENTATION } from "../../../shared/behavioralInterventionMapping";

export type DaphneMissionTrigger = "field_arrival" | "outbound_call" | "non_field";
export type DaphnePresentationVariant = {
  id: string;
  missionType: string;
  trigger: DaphneMissionTrigger;
  immersionLevel: 1 | 2 | 3 | 4 | 5;
  approved: boolean;
};
export type DaphneMissionPresentationEvidence = {
  tenantId: string;
  operatorUserId: string;
  missionId: string;
  missionType: string;
  trigger: DaphneMissionTrigger;
  variantId: string;
  immersionLevel: 1 | 2 | 3 | 4 | 5;
  outcome: "completed" | "skipped" | "unknown";
  verificationStatus: "verified" | "attested" | "disputed" | "rejected";
  sourceRef: string;
  observedAt: string;
  /** When explicitly known, a practical reason overrides the immersion hypothesis. */
  operatorReason?: "timing" | "blocked" | "location" | "explicit_dislike" | "other";
};

export type DaphneImmersionProposal =
  | { status: "abstain"; reason: string; evidenceRefs: string[] }
  | {
      status: "proposed";
      hypothesis: "insufficient_fantasy_immersion";
      epistemicStatus: "association_only";
      /** Proposal is about presentation ONLY. Mission ID and work are unchanged. */
      missionId: string;
      previousVariantId: string;
      proposedVariantId: string;
      previousImmersionLevel: number;
      proposedImmersionLevel: number;
      evidenceRefs: string[];
      requiresExistingPresentationAuthority: true;
    };

export function proposeDaphneImmersionExperiment(input: {
  tenantId: string;
  operatorUserId: string;
  missionId: string;
  missionType: string;
  trigger: DaphneMissionTrigger;
  activeVariantId: string;
  preferences: { adaptationEnabled: boolean; consentRevoked: boolean };
  variants: readonly DaphnePresentationVariant[];
  evidence: readonly DaphneMissionPresentationEvidence[];
  now?: Date;
  maxEvidenceAgeMs?: number;
}): DaphneImmersionProposal {
  const abstain = (reason: string, evidenceRefs: string[] = []): DaphneImmersionProposal =>
    ({ status: "abstain", reason, evidenceRefs });

  if (!input.tenantId.trim() || !input.operatorUserId.trim() ||
      !input.missionId.trim() || !input.missionType.trim()) {
    return abstain("missing_identity_or_mission_authority");
  }
  if (!input.preferences.adaptationEnabled || input.preferences.consentRevoked) {
    return abstain("adaptation_not_consented");
  }
  const applicable = input.variants.filter(v =>
    v.approved && v.missionType === input.missionType && v.trigger === input.trigger
  );
  if (new Set(applicable.map(v => v.id)).size !== applicable.length) {
    return abstain("duplicate_presentation_identity");
  }
  const active = applicable.find(v => v.id === input.activeVariantId);
  if (!active) return abstain("active_presentation_not_approved");
  const now = (input.now ?? new Date()).getTime();
  const maxAge = input.maxEvidenceAgeMs ?? 30 * 24 * 60 * 60_000;
  const eligible = input.evidence.filter(e =>
    e.tenantId === input.tenantId &&
    e.operatorUserId === input.operatorUserId &&
    e.missionId === input.missionId &&
    e.missionType === input.missionType &&
    e.trigger === input.trigger &&
    e.verificationStatus === "verified" &&
    e.sourceRef.trim().length > 0 &&
    Number.isFinite(Date.parse(e.observedAt)) &&
    Date.parse(e.observedAt) <= now && now - Date.parse(e.observedAt) <= maxAge &&
    applicable.some(v => v.id === e.variantId && v.immersionLevel === e.immersionLevel)
  ).sort((a,b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
  const sourceValues = new Map<string, string>();
  for (const item of eligible) {
    const value = JSON.stringify([item.missionId, item.variantId, item.outcome, item.observedAt, item.operatorReason]);
    if (sourceValues.has(item.sourceRef) && sourceValues.get(item.sourceRef) !== value)
      return abstain("conflicting_verified_source", [item.sourceRef]);
    sourceValues.set(item.sourceRef, value);
  }
  const latest = eligible[0];
  if (latest && eligible.some(e => e.observedAt === latest.observedAt &&
      (e.outcome !== latest.outcome || e.variantId !== latest.variantId)))
    return abstain("conflicting_latest_evidence", eligible.filter(e => e.observedAt === latest.observedAt).map(e => e.sourceRef));
  if (!latest || latest.outcome !== "skipped" || latest.variantId !== active.id) {
    return abstain("no_verified_skip_of_current_presentation", latest ? [latest.sourceRef] : []);
  }
  if (latest.operatorReason) {
    return abstain("explicit_operator_reason_should_be_addressed_first", [latest.sourceRef]);
  }
  // A repeated skip at the same or greater immersion is not evidence to keep
  // blindly increasing the fantasy level.
  const priorEscalationSkipped = eligible.slice(1).some(e =>
    e.outcome === "skipped" && e.immersionLevel < active.immersionLevel
  );
  if (priorEscalationSkipped) {
    return abstain("prior_immersion_increase_did_not_resolve_skip", [latest.sourceRef]);
  }
  const next = applicable
    .filter(v => v.immersionLevel > active.immersionLevel)
    .sort((a,b) => a.immersionLevel - b.immersionLevel || a.id.localeCompare(b.id))[0];
  if (!next) return abstain("no_approved_higher_immersion_variant", [latest.sourceRef]);

  return {
    status: "proposed",
    hypothesis: "insufficient_fantasy_immersion",
    epistemicStatus: "association_only",
    missionId: input.missionId,
    previousVariantId: active.id,
    proposedVariantId: next.id,
    previousImmersionLevel: active.immersionLevel,
    proposedImmersionLevel: next.immersionLevel,
    evidenceRefs: [latest.sourceRef],
    requiresExistingPresentationAuthority: true,
  };
}

export type OperatorPresentationFatigueAssessment = {
  throttled: boolean;
  reason: "none" | "explicit_dislike_reported" | "burden_skip_threshold_exceeded";
  recentSkipCount: number;
  evidenceRefs: string[];
};

/**
 * Evaluates operator intervention burden/fatigue from verified presentation outcomes
 * (BEHAVIORAL_SCIENCE_FOUNDATION.md §§5, 7). Repeated skips or explicit dislike
 * throttle motivational framing back to STANDARD_PRESENTATION to prevent alert fatigue.
 */
export function evaluateOperatorPresentationFatigue(input: {
  tenantId: string;
  operatorUserId: string;
  evidence: readonly DaphneMissionPresentationEvidence[];
  now?: Date;
  fatigueWindowMs?: number;
  maxSkipsBeforeThrottle?: number;
}): OperatorPresentationFatigueAssessment {
  const nowMs = (input.now ?? new Date()).getTime();
  const windowMs = input.fatigueWindowMs ?? 7 * 24 * 60 * 60_000;
  const maxSkips = input.maxSkipsBeforeThrottle ?? 2;

  const recentVerified = input.evidence
    .filter(
      e =>
        e.tenantId === input.tenantId &&
        e.operatorUserId === input.operatorUserId &&
        e.verificationStatus === "verified" &&
        e.sourceRef.trim().length > 0 &&
        Number.isFinite(Date.parse(e.observedAt)) &&
        Date.parse(e.observedAt) <= nowMs &&
        nowMs - Date.parse(e.observedAt) <= windowMs
    )
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));

  const explicitDislike = recentVerified.find(e => e.operatorReason === "explicit_dislike");
  if (explicitDislike) {
    return {
      throttled: true,
      reason: "explicit_dislike_reported",
      recentSkipCount: recentVerified.filter(e => e.outcome === "skipped").length,
      evidenceRefs: [explicitDislike.sourceRef],
    };
  }

  // Count consecutive or recent unexplained skips of non-baseline variants in the window.
  const recentSkips = recentVerified.filter(
    e =>
      e.outcome === "skipped" &&
      e.variantId !== STANDARD_PRESENTATION &&
      e.operatorReason !== "timing" &&
      e.operatorReason !== "location" &&
      e.operatorReason !== "blocked"
  );
  if (recentSkips.length >= maxSkips) {
    return {
      throttled: true,
      reason: "burden_skip_threshold_exceeded",
      recentSkipCount: recentSkips.length,
      evidenceRefs: recentSkips.map(e => e.sourceRef),
    };
  }

  return {
    throttled: false,
    reason: "none",
    recentSkipCount: recentSkips.length,
    evidenceRefs: recentSkips.map(e => e.sourceRef),
  };
}

export type DaphneMrtFramingResult =
  | {
      status: "abstain";
      reason: string;
      evidenceRefs: string[];
    }
  | {
      status: "throttled_to_baseline";
      epistemicStatus: "fatigue_throttled_baseline";
      missionId: string;
      decisionPointId: string;
      assignedOption: typeof STANDARD_PRESENTATION;
      assignmentMechanism: "fatigue_throttle";
      assignmentProbability: 1;
      fatigueReason: "explicit_dislike_reported" | "burden_skip_threshold_exceeded";
      recentSkipCount: number;
      evidenceRefs: string[];
    }
  | {
      status: "assigned";
      /** Causal MRT randomization with known non-zero probability and baseline arm. */
      epistemicStatus: "causal_mrt_randomized";
      missionId: string;
      decisionPointId: string;
      eligibleOptions: readonly string[];
      assignedOption: string;
      assignmentMechanism: "randomized_assignment";
      assignmentProbability: number;
      baselineArmIncluded: true;
      proposedCandidateId: string;
      evidenceRefs: string[];
    };

/**
 * Bridges Daphne's consented behavioral adaptation to JOYSTICK's Micro-Randomized
 * Trial (MRT) framework (BEHAVIORAL_SCIENCE_FOUNDATION.md §§2, 5, 7):
 * - Enforces explicit experimentation consent (`safeExperimentation === true`),
 * - Throttles to `STANDARD_PRESENTATION` when recent skips or explicit dislike indicate burden/fatigue,
 * - Includes `STANDARD_PRESENTATION` as the baseline comparison arm with known non-zero assignment probability.
 */
export function assignDaphneMrtMissionFraming(input: {
  tenantId: string;
  operatorUserId: string;
  missionId: string;
  occasionId: string;
  missionType: string;
  trigger: DaphneMissionTrigger;
  activeVariantId: string;
  preferences: {
    adaptationEnabled: boolean;
    safeExperimentation: boolean;
    consentRevoked: boolean;
  };
  variants: readonly DaphnePresentationVariant[];
  evidence: readonly DaphneMissionPresentationEvidence[];
  now?: Date;
  fatigueWindowMs?: number;
  maxSkipsBeforeThrottle?: number;
  randomInt?: (n: number) => number;
}): DaphneMrtFramingResult {
  if (
    !input.tenantId.trim() ||
    !input.operatorUserId.trim() ||
    !input.missionId.trim() ||
    !input.occasionId.trim() ||
    !input.missionType.trim()
  ) {
    return { status: "abstain", reason: "missing_identity_or_mission_authority", evidenceRefs: [] };
  }
  if (!input.preferences.adaptationEnabled || input.preferences.consentRevoked) {
    return { status: "abstain", reason: "adaptation_not_consented", evidenceRefs: [] };
  }
  if (!input.preferences.safeExperimentation) {
    return { status: "abstain", reason: "experimentation_not_consented", evidenceRefs: [] };
  }

  const correlationId = input.missionId.startsWith("ops_task:") || input.missionId.startsWith("campaign:")
    ? input.missionId
    : `ops_task:${input.missionId}`;
  const decisionPointId = presentationDecisionPointId({
    correlationId,
    occasionId: input.occasionId,
  });

  const fatigue = evaluateOperatorPresentationFatigue({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    evidence: input.evidence,
    now: input.now,
    fatigueWindowMs: input.fatigueWindowMs,
    maxSkipsBeforeThrottle: input.maxSkipsBeforeThrottle,
  });
  if (fatigue.throttled && fatigue.reason !== "none") {
    return {
      status: "throttled_to_baseline",
      epistemicStatus: "fatigue_throttled_baseline",
      missionId: input.missionId,
      decisionPointId,
      assignedOption: STANDARD_PRESENTATION,
      assignmentMechanism: "fatigue_throttle",
      assignmentProbability: 1,
      fatigueReason: fatigue.reason,
      recentSkipCount: fatigue.recentSkipCount,
      evidenceRefs: fatigue.evidenceRefs,
    };
  }

  const proposal = proposeDaphneImmersionExperiment({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    missionId: input.missionId,
    missionType: input.missionType,
    trigger: input.trigger,
    activeVariantId: input.activeVariantId,
    preferences: {
      adaptationEnabled: input.preferences.adaptationEnabled,
      consentRevoked: input.preferences.consentRevoked,
    },
    variants: input.variants,
    evidence: input.evidence,
    now: input.now,
  });
  if (proposal.status === "abstain") {
    return proposal;
  }

  const eligibleOptions = Array.from(
    new Set([STANDARD_PRESENTATION, proposal.previousVariantId, proposal.proposedVariantId])
  );
  const draw = drawEqualProbabilityArm({
    options: eligibleOptions,
    randomInt: input.randomInt ?? (n => cryptoRandomInt(n)),
  });
  if (!isValidAssignmentProbability(draw.assignmentProbability) || draw.assignmentProbability >= 1) {
    return { status: "abstain", reason: "invalid_mrt_probability", evidenceRefs: proposal.evidenceRefs };
  }

  return {
    status: "assigned",
    epistemicStatus: "causal_mrt_randomized",
    missionId: input.missionId,
    decisionPointId,
    eligibleOptions,
    assignedOption: draw.assignedOption,
    assignmentMechanism: "randomized_assignment",
    assignmentProbability: draw.assignmentProbability,
    baselineArmIncluded: true,
    proposedCandidateId: proposal.proposedVariantId,
    evidenceRefs: proposal.evidenceRefs,
  };
}

