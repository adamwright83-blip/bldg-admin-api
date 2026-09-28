import { and, desc, eq, isNull, lte } from "drizzle-orm";
import { tenantLearningGovernance } from "../../drizzle/schema";
import type {
  TenantLearningGovernanceRecord,
  TenantLearningGovernanceScope,
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
  const [row] = await db
    .select()
    .from(tenantLearningGovernance)
    .where(
      and(
        eq(tenantLearningGovernance.tenantId, input.tenantId),
        eq(tenantLearningGovernance.scope, input.scope),
        lte(tenantLearningGovernance.effectiveAt, at),
        isNull(tenantLearningGovernance.revokedAt)
      )
    )
    .orderBy(desc(tenantLearningGovernance.version))
    .limit(1);
  if (!row) return null;
  return {
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
}
