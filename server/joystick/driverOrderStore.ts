import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { orders, type Order } from "../../drizzle/schema";
import { getDb } from "../db";

/** Legacy rows with a null or blank tenant belong to the default laundry tenant. */
export function driverOrderTenantSql(tenantId: string) {
  return sql`COALESCE(NULLIF(TRIM(${orders.tenantId}), ''), 'default') = ${tenantId}`;
}

export async function listDriverOrdersByStatus(input: {
  tenantId: string;
  status: Order["status"];
}): Promise<Order[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(orders)
    .where(and(eq(orders.status, input.status), driverOrderTenantSql(input.tenantId)))
    .orderBy(desc(orders.createdAt));
}

export async function listDriverOrdersByDate(input: {
  tenantId: string;
  status: Order["status"];
  date: string;
  dateField: "pickupDate" | "deliveryDate";
}): Promise<Order[]> {
  const db = await getDb();
  if (!db) return [];
  const column =
    input.dateField === "deliveryDate" ? orders.deliveryDate : orders.pickupDate;
  return db
    .select()
    .from(orders)
    .where(
      and(
        eq(column, input.date),
        eq(orders.status, input.status),
        driverOrderTenantSql(input.tenantId)
      )
    )
    .orderBy(desc(orders.createdAt));
}

export async function getDriverOrderForTenant(input: {
  tenantId: string;
  orderId: number;
}): Promise<Order | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, input.orderId), driverOrderTenantSql(input.tenantId)))
    .limit(1);
  return row ?? null;
}

export async function transitionDriverOrder(input: {
  tenantId: string;
  orderId: number;
  from?: Order["status"][];
  to: Order["status"];
}): Promise<{ changed: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const conditions = [
    eq(orders.id, input.orderId),
    driverOrderTenantSql(input.tenantId),
  ];
  if (input.from && input.from.length > 0) {
    conditions.push(inArray(orders.status, input.from));
  }
  const result = await db
    .update(orders)
    .set({ status: input.to })
    .where(and(...conditions));
  const affectedRows = Number(
    (result as { [0]?: { affectedRows?: number } })[0]?.affectedRows ?? 0
  );
  return { changed: affectedRows > 0 };
}
