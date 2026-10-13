import { describe, expect, it, vi } from "vitest";
import { evaluatePersistentActionPolicy, type PersistentActionPolicyInput } from "./actionPolicy";
import { executePersistentOperatorAction } from "./actionExecution";
import type { CanonicalOperatorIdentity } from "./identity";
import * as identityModule from "./identity";
import * as tenantAccessModule from "../../saas/tenantAccess";
import * as autonomyEvidenceModule from "./autonomyEvidence";

const mockIdentity: CanonicalOperatorIdentity = {
  tenantId: "tenant-a",
  canonicalOperatorId: "tenant:tenant-a:operator:adam",
  canonicalOpenId: "adam",
  sourceOpenId: "adam",
  primaryNumericUserId: 42,
  displayName: "Adam",
  role: "operator",
  membership: {
    canonical: "operator",
    sourceRole: "operator",
    active: true,
  },
  aliases: [],
};

function setupPolicyMocks(overrides: {
  entitled?: boolean;
  roleAllowed?: boolean;
} = {}) {
  vi.spyOn(identityModule, "resolveCanonicalOperatorIdentity").mockResolvedValue({
    ok: true,
    identity: mockIdentity,
  });
  vi.spyOn(tenantAccessModule, "hasTenantEntitlement").mockResolvedValue(
    overrides.entitled ?? true
  );
  vi.spyOn(tenantAccessModule, "roleAllows").mockReturnValue(
    overrides.roleAllowed ?? true
  );
}

describe("Earned Autonomy Runtime Permission Boundaries", () => {
  it("allows READ_ONLY and INTERNAL_REVERSIBLE actions automatically", async () => {
    setupPolicyMocks();
    const readResult = await evaluatePersistentActionPolicy({
      tenantId: "tenant-a",
      canonicalOperatorId: "tenant:tenant-a:operator:adam",
      operatorUserId: "adam",
      exactAction: "read_daily_summary",
      riskClass: "READ_ONLY",
    });
    expect(readResult).toEqual({
      allowed: true,
      authority: "automatic",
      standingAuthorizationId: null,
      standingAuthorizationVersion: null,
    });

    const reversibleResult = await evaluatePersistentActionPolicy({
      tenantId: "tenant-a",
      canonicalOperatorId: "tenant:tenant-a:operator:adam",
      operatorUserId: "adam",
      exactAction: "reorder_backlog_queue",
      riskClass: "INTERNAL_REVERSIBLE",
    });
    expect(reversibleResult).toEqual({
      allowed: true,
      authority: "automatic",
      standingAuthorizationId: null,
      standingAuthorizationVersion: null,
    });
  });

  it("strictly fails closed for FINANCIAL_OR_CONTRACTUAL without explicit operator approval", async () => {
    setupPolicyMocks();
    const denied = await evaluatePersistentActionPolicy({
      tenantId: "tenant-a",
      canonicalOperatorId: "tenant:tenant-a:operator:adam",
      operatorUserId: "adam",
      exactAction: "charge_customer_card",
      riskClass: "FINANCIAL_OR_CONTRACTUAL",
    });
    expect(denied).toEqual({
      allowed: false,
      reason: "explicit_approval_required",
    });

    const approved = await evaluatePersistentActionPolicy({
      tenantId: "tenant-a",
      canonicalOperatorId: "tenant:tenant-a:operator:adam",
      operatorUserId: "adam",
      exactAction: "charge_customer_card",
      riskClass: "FINANCIAL_OR_CONTRACTUAL",
      approvedByUserId: "adam",
    });
    expect(approved).toEqual({
      allowed: true,
      authority: "explicit_approval",
      standingAuthorizationId: null,
      standingAuthorizationVersion: null,
    });
  });

  it("enforces earned autonomy level boundaries and denies execution when evidence is insufficient", async () => {
    setupPolicyMocks();

    // Mock evidence showing insufficient completed missions (only 5 completed out of 20 needed for level 1)
    vi.spyOn(autonomyEvidenceModule, "loadClaireAutonomyEvidence").mockResolvedValue({
      tenantId: "tenant-a",
      operatorUserId: "adam",
      relevantMissionsObserved: 10,
      relevantMissionsCompleted: 5,
      verifiedPlanningCycles: 1,
      executionPathCertified: false,
      sourceCoverageFresh: true,
      correctionAndRevocationTested: true,
      criticalOpenDefects: 0,
      consent: { allowedLevel: 1, revoked: false, evidenceRef: "ref-1" },
    });

    const denied = await evaluatePersistentActionPolicy({
      tenantId: "tenant-a",
      canonicalOperatorId: "tenant:tenant-a:operator:adam",
      operatorUserId: "adam",
      exactAction: "autonomous_dispatch",
      riskClass: "EXTERNAL_COMMUNICATION",
      requiredAutonomyLevel: 1,
    });
    expect(denied).toEqual({
      allowed: false,
      reason: "earned_autonomy_not_ready",
    });
  });

  it("permits action when earned autonomy readiness meets the required level", async () => {
    setupPolicyMocks();

    // Mock sufficient verified outcomes, fresh data, certification, and operator consent
    vi.spyOn(autonomyEvidenceModule, "loadClaireAutonomyEvidence").mockResolvedValue({
      tenantId: "tenant-a",
      operatorUserId: "adam",
      relevantMissionsObserved: 40,
      relevantMissionsCompleted: 38,
      verifiedPlanningCycles: 8,
      executionPathCertified: true,
      sourceCoverageFresh: true,
      correctionAndRevocationTested: true,
      criticalOpenDefects: 0,
      consent: { allowedLevel: 2, revoked: false, evidenceRef: "approved:level:2" },
    });

    const allowed = await evaluatePersistentActionPolicy({
      tenantId: "tenant-a",
      canonicalOperatorId: "tenant:tenant-a:operator:adam",
      operatorUserId: "adam",
      exactAction: "autonomous_send_message",
      riskClass: "INTERNAL_REVERSIBLE",
      requiredAutonomyLevel: 2,
    });
    expect(allowed.allowed).toBe(true);
  });

  it("revocation immediately denies runtime action even with high mission counts", async () => {
    setupPolicyMocks();

    vi.spyOn(autonomyEvidenceModule, "loadClaireAutonomyEvidence").mockResolvedValue({
      tenantId: "tenant-a",
      operatorUserId: "adam",
      relevantMissionsObserved: 100,
      relevantMissionsCompleted: 99,
      verifiedPlanningCycles: 20,
      executionPathCertified: true,
      sourceCoverageFresh: true,
      correctionAndRevocationTested: true,
      criticalOpenDefects: 0,
      consent: { allowedLevel: 2, revoked: true, evidenceRef: "revoked:level:2" },
    });

    const denied = await evaluatePersistentActionPolicy({
      tenantId: "tenant-a",
      canonicalOperatorId: "tenant:tenant-a:operator:adam",
      operatorUserId: "adam",
      exactAction: "autonomous_dispatch",
      riskClass: "EXTERNAL_COMMUNICATION",
      requiredAutonomyLevel: 2,
    });
    expect(denied).toEqual({
      allowed: false,
      reason: "earned_autonomy_not_ready",
    });
  });

  it("executePersistentOperatorAction executes admitted action within neutral gate", async () => {
    setupPolicyMocks();

    const executed = await executePersistentOperatorAction({
      identity: mockIdentity,
      actionClass: "operator_audit",
      authorityBasis: "test_execution",
      source: {
        type: "pending_lifecycle",
        tenantId: "tenant-a",
        canonicalOperatorId: "tenant:tenant-a:operator:adam",
        lifecycleId: "life-1",
      },
      sourceReference: "ref:life-1",
      idempotencyKey: "idem:life-1",
      riskClass: "READ_ONLY",
      exactAction: "read_audit_trail",
      expiresAtMs: Date.now() + 60_000,
      execute: async context => {
        expect(context.tenantId).toBe("tenant-a");
        expect(context.exactAction).toBe("read_audit_trail");
        expect(context.policyAuthority).toBe("automatic");
        return { success: true, count: 42 };
      },
    });

    expect(executed).toEqual({
      executed: true,
      result: { success: true, count: 42 },
    });
  });

  it("executePersistentOperatorAction rejects source-to-identity tenant mismatch", async () => {
    setupPolicyMocks();

    await expect(
      executePersistentOperatorAction({
        identity: mockIdentity,
        actionClass: "operator_audit",
        authorityBasis: "test_execution",
        source: {
          type: "pending_lifecycle",
          tenantId: "tenant-foreign",
          canonicalOperatorId: "tenant:tenant-foreign:operator:other",
          lifecycleId: "life-foreign",
        },
        sourceReference: "ref:foreign",
        idempotencyKey: "idem:foreign",
        riskClass: "READ_ONLY",
        exactAction: "read_audit_trail",
        expiresAtMs: Date.now() + 60_000,
        execute: async () => ({ success: true }),
      })
    ).rejects.toThrow(/mismatch/i);
  });
});
