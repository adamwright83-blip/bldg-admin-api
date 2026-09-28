/**
 * Latest CleanCloud sales for a signed-in operator.
 * Payment time, customer name, amount, and when Goldline stored the row.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { cleancloudPaidOrders } from "../../drizzle/schema";
import { getDb } from "../db";

export type LatestCleanCloudSale = {
  at: string | null;
  placedAt: string | null;
  paidAt: string | null;
  ingestedAt: string | null;
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
  ingestedAt: Date | null;
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
    ingestedAt: iso(row.ingestedAt),
    customerName: row.customerName,
    amountCents: row.amountCents,
  };
}

export function dedupeLatestSales(rows: SaleRow[], limit: number): LatestCleanCloudSale[] {
  const byOrder = new Map<string, SaleRow>();
  for (const row of rows) {
    const existing = byOrder.get(row.orderId);
    if (!existing) {
      byOrder.set(row.orderId, row);
      continue;
    }
    const existingIngest = existing.ingestedAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const rowIngest = row.ingestedAt?.getTime() ?? Number.POSITIVE_INFINITY;
    if (rowIngest < existingIngest) {
      byOrder.set(row.orderId, { ...existing, ingestedAt: row.ingestedAt });
    }
  }
  return [...byOrder.values()].slice(0, limit).map(saleFromRow);
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
      ingestedAt: cleancloudPaidOrders.createdAt,
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
        ingestedAt: row.ingestedAt,
      })),
      limit
    ),
  };
}
