import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { orders } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { buildingFor, BUILDING_LABEL } from "../../analytics/businessLineage";
import { formatMoney, joinList, plural } from "../business/businessSpeech";

/**
 * Goldline's own orders that are in progress but not paid — "who still owes
 * money?", "what orders are awaiting payment?". Amounts are the recorded order
 * totals; an order with no total yet is named without inventing one.
 */

export type UnpaidOrder = {
  id: number;
  customerName: string;
  status: string;
  totalCents: number;
  pickupDate: string;
  deliveryDate: string | null;
  building: string | null;
};

export function isUnpaidQuestion(lower: string): boolean {
  return /\b(owes?|owing|still owe|unpaid|awaiting payment|waiting on payment|haven'?t paid|hasn'?t paid|not paid|outstanding balance|collect(?:ed)? payment)\b/.test(lower);
}

export async function loadUnpaidOrders(tenantId: string): Promise<UnpaidOrder[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
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
        sql`COALESCE(${orders.tenantId}, 'default') = ${tenantId}`,
        eq(orders.paid, false),
        inArray(orders.status, ["collected", "processing", "ready"])
      )
    )
    .orderBy(asc(orders.pickupDate), asc(orders.id))
    .limit(100);
  return rows.map(row => {
    const building = buildingFor({ buildingSlug: row.buildingSlug, address: row.address });
    return {
      id: row.id,
      customerName: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || "an unnamed customer",
      status: row.status,
      totalCents: Math.round(Number(row.total ?? 0) * 100),
      pickupDate: row.pickupDate,
      deliveryDate: row.deliveryDate,
      building: building ? BUILDING_LABEL[building] : null,
    };
  });
}

export function speakUnpaidOrders(rows: UnpaidOrder[], surface: "voice" | "text"): string {
  if (!rows.length) return "Nothing in Goldline's own order flow is waiting on payment right now. CleanCloud orders are paid at the register, so they don't show up here.";
  const cap = surface === "voice" ? 6 : 20;
  const priced = rows.filter(row => row.totalCents > 0);
  const total = priced.reduce((sum, row) => sum + row.totalCents, 0);
  const entries = rows.slice(0, cap).map(row => {
    const amount = row.totalCents > 0 ? `${formatMoney(row.totalCents, true)}` : "no total entered yet";
    return `${row.customerName}, ${amount}, ${row.status}`;
  });
  const rest = rows.length - entries.length;
  const listed = rest > 0 ? `${entries.join("; ")}; and ${rest} more` : joinList(entries);
  const sum = priced.length ? ` That's ${formatMoney(total)} across the ${priced.length} with a total.` : "";
  return `${rows.length} Goldline ${plural(rows.length, "order is", "orders are")} waiting on payment: ${listed}.${sum}`;
}
