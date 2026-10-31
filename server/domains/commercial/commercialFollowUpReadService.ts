import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import {
  commercialAccounts,
  commercialFollowUps,
  commercialPipelineRecords,
} from "../../../drizzle/schema";
import { getDb } from "../../db";
import { isMysqlMissingTableError } from "../../mysqlErrors";

export type OpenCommercialFollowUp = {
  id: string;
  missionId: number;
  dueAt: Date;
  note: string;
  /** The account the follow-up's pipeline record belongs to; null when that link is missing. */
  accountName: string | null;
};

export type CommercialFollowUpState = {
  id: string;
  missionId: number;
  status: "open" | "completed" | "cancelled";
  dueAt: Date;
};

export type CompletedCommercialFollowUp = {
  id: string;
  completedAt: Date;
};

export async function listOpenCommercialFollowUps(
  tenantId: string
): Promise<OpenCommercialFollowUp[]> {
  const scopedTenantId = tenantId.trim();
  if (!scopedTenantId) throw new Error("Commercial follow-up read requires tenant authority");
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    return await db
      .select({
        id: commercialFollowUps.id,
        missionId: commercialFollowUps.missionId,
        dueAt: commercialFollowUps.dueAt,
        note: commercialFollowUps.note,
        accountName: commercialAccounts.name,
      })
      .from(commercialFollowUps)
      .leftJoin(
        commercialPipelineRecords,
        and(
          eq(commercialPipelineRecords.tenantId, commercialFollowUps.tenantId),
          eq(commercialPipelineRecords.id, commercialFollowUps.pipelineId)
        )
      )
      .leftJoin(
        commercialAccounts,
        and(
          eq(commercialAccounts.tenantId, commercialPipelineRecords.tenantId),
          eq(commercialAccounts.id, commercialPipelineRecords.accountId)
        )
      )
      .where(
        and(
          eq(commercialFollowUps.tenantId, scopedTenantId),
          eq(commercialFollowUps.status, "open")
        )
      )
      .orderBy(asc(commercialFollowUps.dueAt), asc(commercialFollowUps.id))
      .limit(250);
  } catch (error) {
    if (isMysqlMissingTableError(error)) return [];
    throw error;
  }
}

/**
 * The current state of the named follow-ups, whatever it is, so work scheduled
 * from them can be reconciled. A follow-up not returned is unknown, not closed;
 * an unmigrated table is unknown too (null), never "every follow-up closed".
 */
export async function listCommercialFollowUpStates(
  tenantId: string,
  followUpIds: readonly string[]
): Promise<CommercialFollowUpState[] | null> {
  const scopedTenantId = tenantId.trim();
  if (!scopedTenantId) throw new Error("Commercial follow-up read requires tenant authority");
  const ids = [...new Set(followUpIds.map(id => id.trim()).filter(Boolean))];
  if (!ids.length) return [];
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    return await db
      .select({
        id: commercialFollowUps.id,
        missionId: commercialFollowUps.missionId,
        status: commercialFollowUps.status,
        dueAt: commercialFollowUps.dueAt,
      })
      .from(commercialFollowUps)
      .where(
        and(
          eq(commercialFollowUps.tenantId, scopedTenantId),
          inArray(commercialFollowUps.id, ids)
        )
      );
  } catch (error) {
    if (isMysqlMissingTableError(error)) return null;
    throw error;
  }
}

export async function listCompletedCommercialFollowUpsForOperator(input: {
  tenantId: string;
  operatorUserId: string;
}): Promise<CompletedCommercialFollowUp[]> {
  const tenantId = input.tenantId.trim();
  const operatorUserId = input.operatorUserId.trim();
  if (!tenantId || !operatorUserId) {
    throw new Error("Completed follow-up read requires tenant and operator authority");
  }
  const db = await getDb();
  if (!db) return [];
  try {
    const rows = await db
      .select({
        id: commercialFollowUps.id,
        completedAt: commercialFollowUps.completedAt,
      })
      .from(commercialFollowUps)
      .where(
        and(
          eq(commercialFollowUps.tenantId, tenantId),
          eq(commercialFollowUps.status, "completed"),
          eq(commercialFollowUps.completedBy, operatorUserId),
          isNotNull(commercialFollowUps.completedAt)
        )
      );
    return rows.flatMap(row =>
      row.completedAt ? [{ id: row.id, completedAt: row.completedAt }] : []
    );
  } catch (error) {
    if (isMysqlMissingTableError(error)) return [];
    throw error;
  }
}
