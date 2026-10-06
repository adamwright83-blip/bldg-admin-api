import { desc, eq } from "drizzle-orm";
import { cleancloudPaidOrders } from "../../drizzle/schema";
import { getDb } from "../db";

export async function listRecentCleanCloudCustomerNames(
  tenantIdInput: string,
  limit = 300
): Promise<string[]> {
  const tenantId = tenantIdInput.trim();
  if (!tenantId) throw new Error("CleanCloud customer read requires tenant authority");
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ name: cleancloudPaidOrders.customerName })
    .from(cleancloudPaidOrders)
    .where(eq(cleancloudPaidOrders.tenantId, tenantId))
    .orderBy(desc(cleancloudPaidOrders.id))
    .limit(Math.max(1, Math.min(limit, 500)));
  return rows.flatMap(row => row.name?.trim() ? [row.name.trim()] : []);
}
