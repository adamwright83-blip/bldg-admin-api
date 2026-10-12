import { describe, expect, it } from "vitest";
import {
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
  variants, evidence: [evidence()], ...changes,
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
