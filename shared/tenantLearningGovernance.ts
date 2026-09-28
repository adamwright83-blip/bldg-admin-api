export const TENANT_LEARNING_GOVERNANCE_SCOPES = [
  "cross_tenant_execution_learning",
] as const;
export type TenantLearningGovernanceScope =
  (typeof TENANT_LEARNING_GOVERNANCE_SCOPES)[number];

export type TenantLearningGovernanceRecord = {
  id: string;
  tenantId: string;
  scope: TenantLearningGovernanceScope;
  version: number;
  termsVersion: string;
  policyVersion: string;
  permittedAggregationUse: boolean;
  authorizedByUserId: string;
  effectiveAt: string;
  revokedAt: string | null;
};

export function tenantGovernanceAllowsAggregation(
  record: TenantLearningGovernanceRecord | null,
  at = new Date()
): boolean {
  if (!record?.permittedAggregationUse) return false;
  const effectiveAt = Date.parse(record.effectiveAt);
  if (!Number.isFinite(effectiveAt) || effectiveAt > at.getTime()) return false;
  if (record.revokedAt) {
    const revokedAt = Date.parse(record.revokedAt);
    if (!Number.isFinite(revokedAt) || revokedAt <= at.getTime()) return false;
  }
  return true;
}
