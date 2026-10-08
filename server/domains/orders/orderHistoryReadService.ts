import { and, desc, eq } from "drizzle-orm";
import { orders } from "../../../drizzle/schema";
import { getDb } from "../../db";

/** Orders facts only. Payment admission and external evidence are composed by consumers. */
export const NATIVE_CUSTOMER_HISTORY_COLUMNS = {
  tenantId: orders.tenantId,
  id: orders.id,
  status: orders.status,
  createdAt: orders.createdAt,
  firstName: orders.firstName,
  lastName: orders.lastName,
  phone: orders.phone,
  email: orders.email,
  address: orders.address,
  unit: orders.unit,
  buildingSlug: orders.buildingSlug,
  bldgUserId: orders.bldgUserId,
  paid: orders.paid,
  stripePaymentIntentId: orders.stripePaymentIntentId,
  total: orders.total,
} as const;

type OrdersReadDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export async function readNativeCustomerHistory(
  tenantId: string,
  database?: OrdersReadDb
) {
  if (!tenantId.trim())
    throw new Error("Orders history requires established tenant authority");
  const db = database ?? (await getDb());
  if (!db) throw new Error("Database not available");
  return db
    .select(NATIVE_CUSTOMER_HISTORY_COLUMNS)
    .from(orders)
    .where(eq(orders.tenantId, tenantId));
}

/** Established operator compatibility only. Does not admit tenant or Payment authority. */
export async function readLegacyNativeCustomerHistoryAcrossTenants(
  database?: OrdersReadDb
) {
  const db = database ?? (await getDb());
  if (!db) throw new Error("Database not available");
  return db.select(NATIVE_CUSTOMER_HISTORY_COLUMNS).from(orders);
}


/** Orders-owned vendor view. Payment truth must be composed by Payment consumers. */
export async function readNativeOrdersForVendor(
  vendorId: number,
  database?: OrdersReadDb
) {
  if (!Number.isInteger(vendorId) || vendorId <= 0)
    throw new Error("Vendor order history requires established vendor authority");
  const db = database ?? (await getDb());
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(orders)
    .where(eq(orders.vendorId, vendorId))
    .orderBy(desc(orders.createdAt));
}


/** Native paid candidates; capture occurrence must be resolved by Payment before windowing. */
export async function readNativePaidCandidates(tenantId: string) {
  if (!tenantId.trim()) throw new Error("Payment candidates require established tenant authority");
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select({ ...NATIVE_CUSTOMER_HISTORY_COLUMNS, paidAt: orders.paidAt, serviceType: orders.serviceType })
    .from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.paid, true)));
}
