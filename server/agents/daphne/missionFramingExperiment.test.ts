import { describe, expect, it } from "vitest";
import { STANDARD_PRESENTATION } from "../../../shared/behavioralInterventionMapping";
import {
  assignDaphneMrtMissionFraming,
  evaluateOperatorPresentationFatigue,
  proposeDaphneImmersionExperiment,
  type DaphneMissionPresentationEvidence,
  type DaphnePresentationVariant,
} from "./missionFramingExperiment";

const variants: DaphnePresentationVariant[] = [
  { id: "plain", missionType: "cold_call", trigger: "outbound_call", immersionLevel: 1, approved: true },
  { id: "station", missionType: "cold_call", trigger: "outbound_call", immersionLevel: 3, approved: true },
  { id: "infiltration", missionType: "cold_call", trigger: "outbound_call", immersionLevel: 5, approved: false },
  { id: "door", missionType: "field_visit", trigger: "field_arrival", immersionLevel: 4, approved: true },
];

const evidence = (changes: Partial<DaphneMissionPresentationEvidence> = {}): DaphneMissionPresentationEvidence => ({
  tenantId: "t1", operatorUserId: "op1", missionId: "mis_call",
  missionType: "cold_call", trigger: "outbound_call", variantId: "plain",
  immersionLevel: 1, outcome: "skipped", verificationStatus: "verified",
  observedAt: "2026-10-12T18:00:00Z", sourceRef: "outcome:verified:1", ...changes,
});
const run = (changes: Record<string, unknown> = {}) => proposeDaphneImmersionExperiment({
  tenantId: "t1", operatorUserId: "op1", missionId: "mis_call",
  missionType: "cold_call", trigger: "outbound_call", activeVariantId: "plain",
  preferences: { adaptationEnabled: true, consentRevoked: false },
  variants, evidence: [evidence()], now: new Date("2026-10-12T20:00:00Z"), ...changes,
});

describe("Daphne immersion hypotheses", () => {
  it("suggests the next approved fantasy presentation while preserving mission identity", () => {
    const proposal = run();
    expect(proposal).toMatchObject({
      status: "proposed", missionId: "mis_call",
      proposedVariantId: "station", previousImmersionLevel: 1,
      proposedImmersionLevel: 3, epistemicStatus: "association_only",
      requiresExistingPresentationAuthority: true,
    });
  });
  it("does not replace cold calls with an unrelated door visit", () => {
    const proposal = run();
    expect(proposal.status).toBe("proposed");
    if (proposal.status === "proposed") {
      expect(proposal.proposedVariantId).not.toBe("door");
      expect(proposal.missionId).toBe("mis_call");
    }
  });
  it("fails closed on revoked or absent consent", () => {
    expect(run({ preferences: { adaptationEnabled: true, consentRevoked: true } }).status).toBe("abstain");
    expect(run({ preferences: { adaptationEnabled: false, consentRevoked: false } }).status).toBe("abstain");
  });
  it("refuses disputed or unrelated operator evidence", () => {
    expect(run({ evidence: [evidence({ verificationStatus: "disputed" })] }).status).toBe("abstain");
    expect(run({ evidence: [evidence({ operatorUserId: "other_operator" })] }).status).toBe("abstain");
    expect(run({ evidence: [evidence({ tenantId: "other_tenant" })] }).status).toBe("abstain");
  });
  it("does not diagnose immersion resistance when timing or location is explicitly reported", () => {
    expect(run({ evidence: [evidence({ operatorReason: "timing" })] })).toMatchObject({
      status: "abstain", reason: "explicit_operator_reason_should_be_addressed_first",
    });
  });
  it("does not keep escalating after a failed higher-immersion trial", () => {
    expect(run({
      activeVariantId: "station",
      evidence: [
        evidence({ observedAt: "2026-10-12T19:00:00Z", variantId: "station", immersionLevel: 3, sourceRef: "outcome:2" }),
        evidence({ observedAt: "2026-10-10T19:00:00Z", variantId: "plain", immersionLevel: 1 }),
      ],
    })).toMatchObject({ status: "abstain", reason: "prior_immersion_increase_did_not_resolve_skip" });
  });
  it("never proposes unapproved higher-level variants", () => {
    expect(run({
      activeVariantId: "station",
      evidence: [evidence({ variantId: "station", immersionLevel: 3 })],
    })).toMatchObject({ status: "abstain", reason: "no_approved_higher_immersion_variant" });
  });
});

describe("Daphne MRT randomization & burden/fatigue throttling", () => {
  it("includes STANDARD_PRESENTATION baseline arm and logs non-zero assignmentProbability under MRT consent", () => {
    const result = assignDaphneMrtMissionFraming({
      tenantId: "t1",
      operatorUserId: "op1",
      missionId: "mis_call",
      occasionId: "2026-10-12-am",
      missionType: "cold_call",
      trigger: "outbound_call",
      activeVariantId: "plain",
      preferences: { adaptationEnabled: true, safeExperimentation: true, consentRevoked: false },
      variants,
      evidence: [evidence()],
      now: new Date("2026-10-12T20:00:00Z"),
      randomInt: () => 2,
    });

    expect(result).toMatchObject({
      status: "assigned",
      epistemicStatus: "causal_mrt_randomized",
      missionId: "mis_call",
      decisionPointId: "ops_task:mis_call:offer:2026-10-12-am",
      eligibleOptions: [STANDARD_PRESENTATION, "plain", "station"],
      assignedOption: "station",
      assignmentMechanism: "randomized_assignment",
      baselineArmIncluded: true,
      proposedCandidateId: "station",
    });
    if (result.status === "assigned") {
      expect(result.assignmentProbability).toBeCloseTo(1 / 3, 5);
    }
  });

  it("throttles back to STANDARD_PRESENTATION when repeated skips in the fatigue window indicate burden", () => {
    const fatigue = evaluateOperatorPresentationFatigue({
      tenantId: "t1",
      operatorUserId: "op1",
      evidence: [
        evidence({ missionId: "mis_1", observedAt: "2026-10-12T18:00:00Z", sourceRef: "skip:1" }),
        evidence({ missionId: "mis_2", observedAt: "2026-10-11T18:00:00Z", sourceRef: "skip:2" }),
      ],
      now: new Date("2026-10-12T20:00:00Z"),
    });
    expect(fatigue).toEqual({
      throttled: true,
      reason: "burden_skip_threshold_exceeded",
      recentSkipCount: 2,
      evidenceRefs: ["skip:1", "skip:2"],
    });

    const result = assignDaphneMrtMissionFraming({
      tenantId: "t1",
      operatorUserId: "op1",
      missionId: "mis_call",
      occasionId: "2026-10-12-pm",
      missionType: "cold_call",
      trigger: "outbound_call",
      activeVariantId: "plain",
      preferences: { adaptationEnabled: true, safeExperimentation: true, consentRevoked: false },
      variants,
      evidence: [
        evidence({ missionId: "mis_call", observedAt: "2026-10-12T18:00:00Z", sourceRef: "skip:1" }),
        evidence({ missionId: "mis_other", observedAt: "2026-10-11T18:00:00Z", sourceRef: "skip:2" }),
      ],
      now: new Date("2026-10-12T20:00:00Z"),
    });

    expect(result).toEqual({
      status: "throttled_to_baseline",
      epistemicStatus: "fatigue_throttled_baseline",
      missionId: "mis_call",
      decisionPointId: "ops_task:mis_call:offer:2026-10-12-pm",
      assignedOption: STANDARD_PRESENTATION,
      assignmentMechanism: "fatigue_throttle",
      assignmentProbability: 1,
      fatigueReason: "burden_skip_threshold_exceeded",
      recentSkipCount: 2,
      evidenceRefs: ["skip:1", "skip:2"],
    });
  });

  it("throttles immediately on explicit_dislike and abstains when safeExperimentation is not consented", () => {
    const disliked = assignDaphneMrtMissionFraming({
      tenantId: "t1",
      operatorUserId: "op1",
      missionId: "mis_call",
      occasionId: "2026-10-12-dislike",
      missionType: "cold_call",
      trigger: "outbound_call",
      activeVariantId: "plain",
      preferences: { adaptationEnabled: true, safeExperimentation: true, consentRevoked: false },
      variants,
      evidence: [evidence({ operatorReason: "explicit_dislike", sourceRef: "dislike:1" })],
      now: new Date("2026-10-12T20:00:00Z"),
    });
    expect(disliked).toMatchObject({
      status: "throttled_to_baseline",
      assignedOption: STANDARD_PRESENTATION,
      fatigueReason: "explicit_dislike_reported",
    });

    const unconsented = assignDaphneMrtMissionFraming({
      tenantId: "t1",
      operatorUserId: "op1",
      missionId: "mis_call",
      occasionId: "2026-10-12-no-exp",
      missionType: "cold_call",
      trigger: "outbound_call",
      activeVariantId: "plain",
      preferences: { adaptationEnabled: true, safeExperimentation: false, consentRevoked: false },
      variants,
      evidence: [evidence()],
      now: new Date("2026-10-12T20:00:00Z"),
    });
    expect(unconsented).toEqual({
      status: "abstain",
      reason: "experimentation_not_consented",
      evidenceRefs: [],
    });
  });
});

