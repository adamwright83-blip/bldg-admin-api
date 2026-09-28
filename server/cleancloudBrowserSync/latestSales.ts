/**
 * Latest CleanCloud sales for a signed-in operator.
 * Date, time, customer name, and amount. Nothing else.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { cleancloudPaidOrders } from "../../drizzle/schema";
import { getDb } from "../db";

export type LatestCleanCloudSale = {
  at: string | null;
  placedAt: string | null;
  paidAt: string | null;
  customerName: string;
  amountCents: number;
};

type SaleRow = {
  orderId: string;
  customerName: string;
  amountCents: number;
  placedAt: Date | null;
  paymentAt: Date | null;
  paidAt: Date | null;
};

function iso(value: Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function saleFromRow(row: SaleRow): LatestCleanCloudSale {
  const paidAt = iso(row.paymentAt) ?? iso(row.paidAt);
  const placedAt = iso(row.placedAt);
  return {
    at: paidAt ?? placedAt,
    placedAt,
    paidAt,
    customerName: row.customerName,
    amountCents: row.amountCents,
  };
}

export function dedupeLatestSales(rows: SaleRow[], limit: number): LatestCleanCloudSale[] {
  const seen = new Set<string>();
  const sales: LatestCleanCloudSale[] = [];
  for (const row of rows) {
    if (seen.has(row.orderId)) continue;
    seen.add(row.orderId);
    sales.push(saleFromRow(row));
    if (sales.length >= limit) break;
  }
  return sales;
}

export async function loadLatestCleanCloudSales(input: {
  tenantId: string;
  limit?: number;
}): Promise<{ sales: LatestCleanCloudSale[] }> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const db = await getDb();
  if (!db) return { sales: [] };
  const saleAt = sql`COALESCE(${cleancloudPaidOrders.paymentDateUtc}, ${cleancloudPaidOrders.paidDateUtc}, ${cleancloudPaidOrders.placedAtUtc})`;
  const rows = await db
    .select({
      orderId: cleancloudPaidOrders.cleancloudOrderId,
      customerName: cleancloudPaidOrders.customerName,
      amountCents: cleancloudPaidOrders.totalCents,
      placedAt: cleancloudPaidOrders.placedAtUtc,
      paymentAt: cleancloudPaidOrders.paymentDateUtc,
      paidAt: cleancloudPaidOrders.paidDateUtc,
    })
    .from(cleancloudPaidOrders)
    .where(
      and(
        eq(cleancloudPaidOrders.tenantId, input.tenantId),
        eq(cleancloudPaidOrders.paid, true)
      )
    )
    .orderBy(desc(saleAt), desc(cleancloudPaidOrders.id))
    .limit(limit * 2);
  return {
    sales: dedupeLatestSales(
      rows.map(row => ({
        orderId: row.orderId,
        customerName: row.customerName,
        amountCents: Number(row.amountCents ?? 0),
        placedAt: row.placedAt,
        paymentAt: row.paymentAt,
        paidAt: row.paidAt,
      })),
      limit
    ),
  };
}
