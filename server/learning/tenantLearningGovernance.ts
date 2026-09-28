import { and, desc, eq, lte } from "drizzle-orm";
import { tenantLearningGovernance } from "../../drizzle/schema";
import {
  tenantGovernanceAllowsAggregation,
  type TenantLearningGovernanceRecord,
  type TenantLearningGovernanceScope,
} from "../../shared/tenantLearningGovernance";
import { getDb } from "../db";

export async function loadActiveTenantLearningGovernance(input: {
  tenantId: string;
  scope: TenantLearningGovernanceScope;
  at?: Date;
}): Promise<TenantLearningGovernanceRecord | null> {
  if (!input.tenantId.trim()) throw new Error("tenantId is required");
  const db = await getDb();
  if (!db) return null;
  const at = input.at ?? new Date();

  // Select the latest effective governance version first. A revoked newest
  // version must fail closed; it must never expose an older still-unrevoked row.
  const [row] = await db
    .select()
    .from(tenantLearningGovernance)
    .where(
      and(
        eq(tenantLearningGovernance.tenantId, input.tenantId),
        eq(tenantLearningGovernance.scope, input.scope),
        lte(tenantLearningGovernance.effectiveAt, at)
      )
    )
    .orderBy(desc(tenantLearningGovernance.version))
    .limit(1);
  if (!row) return null;

  const record: TenantLearningGovernanceRecord = {
    id: row.id,
    tenantId: row.tenantId,
    scope: row.scope as TenantLearningGovernanceScope,
    version: row.version,
    termsVersion: row.termsVersion,
    policyVersion: row.policyVersion,
    permittedAggregationUse: Boolean(row.permittedAggregationUse),
    authorizedByUserId: row.authorizedByUserId,
    effectiveAt: row.effectiveAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };

  return tenantGovernanceAllowsAggregation(record, at) ? record : null;
}
