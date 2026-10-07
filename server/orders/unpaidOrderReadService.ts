import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { orders } from "../../drizzle/schema";
import { getDb } from "../db";

export type UnpaidOrderReadRecord = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  status: string;
  total: unknown;
  pickupDate: string;
  deliveryDate: string | null;
  buildingSlug: string | null;
  address: string;
};

export async function listTenantUnpaidOrders(
  tenantId: string
): Promise<UnpaidOrderReadRecord[]> {
  const scopedTenantId = tenantId.trim();
  if (!scopedTenantId) throw new Error("Unpaid-order read requires tenant authority");
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select({
      id: orders.id,
      firstName: orders.firstName,
      lastName: orders.lastName,
      status: orders.status,
      total: orders.total,
      pickupDate: orders.pickupDate,
      deliveryDate: orders.deliveryDate,
      buildingSlug: orders.buildingSlug,
      address: orders.address,
    })
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, scopedTenantId),
        eq(orders.paid, false),
        inArray(orders.status, ["collected", "processing", "ready"])
      )
    )
    .orderBy(asc(orders.pickupDate), asc(orders.id))
    .limit(100);
}


export async function listRecentTenantOrderCustomerNames(
  tenantIdInput: string,
  limit = 300
): Promise<string[]> {
  const tenantId = tenantIdInput.trim();
  if (!tenantId) throw new Error("Order customer read requires tenant authority");
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ first: orders.firstName, last: orders.lastName })
    .from(orders)
    .where(eq(orders.tenantId, tenantId))
    .orderBy(desc(orders.id))
    .limit(Math.max(1, Math.min(limit, 500)));
  return rows.flatMap(row => {
    const name = `${row.first ?? ""} ${row.last ?? ""}`.trim();
    return name ? [name] : [];
  });
}
