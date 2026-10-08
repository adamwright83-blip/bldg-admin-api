import { eq } from "drizzle-orm";
import { orders } from "../../drizzle/schema";
import { getDb } from "../db";

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
