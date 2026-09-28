import { describe, expect, it } from "vitest";
import {
  tenantGovernanceAllowsAggregation,
  type TenantLearningGovernanceRecord,
} from "./tenantLearningGovernance";

const record = (
  overrides: Partial<TenantLearningGovernanceRecord> = {}
): TenantLearningGovernanceRecord => ({
  id: "g1",
  tenantId: "tenant-a",
  scope: "cross_tenant_execution_learning",
  version: 1,
  termsVersion: "terms-v1",
  policyVersion: "policy-v1",
  permittedAggregationUse: true,
  authorizedByUserId: "owner-a",
  effectiveAt: "2026-09-01T00:00:00.000Z",
  revokedAt: null,
  ...overrides,
});

describe("tenantGovernanceAllowsAggregation", () => {
  const now = new Date("2026-09-28T12:00:00.000Z");

  it("requires affirmative versioned consent", () => {
    expect(tenantGovernanceAllowsAggregation(null, now)).toBe(false);
    expect(
      tenantGovernanceAllowsAggregation(
        record({ permittedAggregationUse: false }),
        now
      )
    ).toBe(false);
  });

  it("fails closed before effective time and after revocation", () => {
    expect(
      tenantGovernanceAllowsAggregation(
        record({ effectiveAt: "2026-10-01T00:00:00.000Z" }),
        now
      )
    ).toBe(false);
    expect(
      tenantGovernanceAllowsAggregation(
        record({ revokedAt: "2026-09-20T00:00:00.000Z" }),
        now
      )
    ).toBe(false);
  });

  it("allows only an active affirmative record", () => {
    expect(tenantGovernanceAllowsAggregation(record(), now)).toBe(true);
  });
});
