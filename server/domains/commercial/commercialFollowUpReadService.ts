import { and, asc, eq, isNotNull } from "drizzle-orm";
import { commercialFollowUps } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { isMysqlMissingTableError } from "../../mysqlErrors";

export type OpenCommercialFollowUp = {
  id: string;
  missionId: number;
  dueAt: Date;
  note: string;
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
      })
      .from(commercialFollowUps)
      .where(
        and(
          eq(commercialFollowUps.tenantId, scopedTenantId),
          eq(commercialFollowUps.status, "open")
        )
      )
      .orderBy(asc(commercialFollowUps.dueAt))
      .limit(250);
  } catch (error) {
    if (isMysqlMissingTableError(error)) return [];
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
