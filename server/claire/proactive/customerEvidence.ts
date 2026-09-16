import { and, eq, notInArray, sql } from "drizzle-orm";
import { cleancloudPaidOrders, orders } from "../../../drizzle/schema";
import { groupCustomers } from "../../analytics/businessMetrics";
import { identityKeysFor } from "../../analytics/customerIdentityResolution";
import { loadPaidOrderLedger } from "../../analytics/paidOrderLedger";
import { businessToday } from "../../analytics/businessPeriods";
import { getDashboardTimeZone, zonedDayStartUtc } from "../../dashboardZoned";
import { getDb } from "../../db";
import type { CustomerEvidence } from "../../../shared/claireProactive";

function daysBetween(later: string, earlier: string): number {
  return Math.round(
    (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) /
      86_400_000
  );
}

function overlap(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(a);
  return b.some(key => set.has(key));
}

function sourceStatusOpen(status: string | null | undefined): boolean {
  const value = String(status ?? "").trim().toLowerCase();
  if (!value) return false;
  return !/^(collected|complete|completed|delivered|cancelled|canceled|refunded|void|voided)$/.test(
    value
  );
}

export type CustomerEvidenceBundle = {
  customers: CustomerEvidence[];
  openOrderCoverage: "complete_native_partial_cleancloud" | "complete_native";
};

/**
 * Build proactive-customer evidence from the same paid-order ledger Claire uses
 * conversationally. Nothing in this function fabricates order intervals,
 * spend, open-order state, or outreach.
 *
 * Native open-order coverage is authoritative for Goldline's own order flow.
 * CleanCloud open-order evidence is limited to source Status values present in
 * imported Orders (Sales) rows; absence there is therefore explicitly partial
 * rather than treated as proof that no CleanCloud job exists.
 */
export async function loadCustomerEvidence(input: {
  tenantId: string;
  now?: Date;
  timeZone?: string;
}): Promise<CustomerEvidenceBundle> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? getDashboardTimeZone();
  const today = businessToday(now, timeZone);

  const [ledger, nativeOpen, cleancloudStatusRows] = await Promise.all([
    loadPaidOrderLedger({
      tenantId: input.tenantId,
      startUtc: zonedDayStartUtc("2020-01-01", timeZone),
      endExclusiveUtc: new Date(now.getTime() + 86_400_000),
      timeZone,
    }),
    db
      .select({
        id: orders.id,
        phone: orders.phone,
        email: orders.email,
        bldgUserId: orders.bldgUserId,
      })
      .from(orders)
      .where(
        and(
          sql`COALESCE(${orders.tenantId}, 'default') = ${input.tenantId}`,
          notInArray(orders.status, ["delivered", "cancelled"])
        )
      ),
    db
      .select({
        cleancloudOrderId: cleancloudPaidOrders.cleancloudOrderId,
        cleancloudCustomerId: cleancloudPaidOrders.cleancloudCustomerId,
        customerPhone: cleancloudPaidOrders.customerPhone,
        customerEmail: cleancloudPaidOrders.customerEmail,
        orderStatus: cleancloudPaidOrders.orderStatus,
      })
      .from(cleancloudPaidOrders)
      .where(eq(cleancloudPaidOrders.tenantId, input.tenantId)),
  ]);

  if (ledger.completeness === "unavailable") {
    throw new Error("Paid-order ledger unavailable");
  }

  const nativeOpenKeys = nativeOpen.map(row => ({
    orderKey: `native-open:${row.id}`,
    keys: identityKeysFor({
      phone: row.phone,
      email: row.email,
      bldgUserId: row.bldgUserId,
    }),
  }));
  const cleancloudOpenKeys = cleancloudStatusRows
    .filter(row => sourceStatusOpen(row.orderStatus))
    .map(row => ({
      orderKey: `cleancloud-open:${row.cleancloudOrderId}`,
      keys: identityKeysFor({
        phone: row.customerPhone,
        email: row.customerEmail,
        cleancloudCustomerId: row.cleancloudCustomerId,
      }),
    }));

  const groups = groupCustomers(ledger.events).filter(group => group.matched);
  const customers = groups.map(group => {
    const sorted = [...group.records].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()
    );
    const last = sorted[sorted.length - 1]!;
    const intervals = sorted
      .slice(1)
      .map((item, index) =>
        daysBetween(item.businessDate, sorted[index]!.businessDate)
      )
      .filter(days => days > 0 && days <= 120);
    const cadence = intervals.length
      ? Math.round(intervals.reduce((sum, days) => sum + days, 0) / intervals.length)
      : null;
    const name =
      [...sorted].reverse().find(record => record.customerName)?.customerName ??
      "an unnamed customer";
    const groupKeys = group.keys;
    const openOrders = [...nativeOpenKeys, ...cleancloudOpenKeys].filter(item =>
      overlap(groupKeys, item.keys)
    );
    const hasCleanCloudHistory = sorted.some(record => record.source === "cleancloud");

    return {
      identityKey: group.identityId,
      displayName: name,
      paidOrderCount: sorted.length,
      lifetimeRevenueCents: sorted.reduce((sum, record) => sum + record.cents, 0),
      lastPaidOn: last.businessDate,
      daysSinceLastPaid: Math.max(0, daysBetween(today, last.businessDate)),
      expectedCadenceDays: cadence,
      openOrderCount: new Set(openOrders.map(item => item.orderKey)).size,
      openOrderCoverage: hasCleanCloudHistory ? ("partial" as const) : ("complete" as const),
      // A null outreach date means no connected outreach evidence is available;
      // it is not rewritten as a claim that no outreach occurred.
      outreachCoverage: "unknown" as const,
      lastOutreachOn: null,
      attestedOutreachOn: null,
    } satisfies CustomerEvidence;
  });

  return {
    customers,
    openOrderCoverage: groups.some(group =>
      group.records.some(record => record.source === "cleancloud")
    )
      ? "complete_native_partial_cleancloud"
      : "complete_native",
  };
}

export function buildTruthfulRecoveryDraft(customer: CustomerEvidence): string {
  const first = customer.displayName.split(/\s+/)[0]?.trim();
  const greeting = first && first !== "an" ? `Hi ${first} — ` : "Hi — ";
  return `${greeting}Adam here. Just checking in. If you need laundry pickup this week, I can help.`;
}
