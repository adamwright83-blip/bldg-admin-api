/**
 * Read-only, consent-gated proposal for testing fantasy immersion.
 *
 * A skip is evidence of noncompletion, not proof of the reason. This service
 * cannot change the real work objective, initiate a call, change game canon,
 * or authorize mission execution. Only already-approved presentation variants
 * may be suggested; a separate authorized system must activate them.
 */

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
  const eligible = input.evidence.filter(e =>
    e.tenantId === input.tenantId &&
    e.operatorUserId === input.operatorUserId &&
    e.missionType === input.missionType &&
    e.trigger === input.trigger &&
    e.verificationStatus === "verified" &&
    e.sourceRef.trim().length > 0 &&
    !Number.isNaN(Date.parse(e.observedAt))
  ).sort((a,b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
  const latest = eligible[0];
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
