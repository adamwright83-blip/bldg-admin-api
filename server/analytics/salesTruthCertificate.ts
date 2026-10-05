import { createHash } from "node:crypto";
import { parseCsv } from "../../extensions/gumballpals/core.js";
import { normalizeCleanCloudPaidOrderRow } from "../cleancloudPaidOrders";
import {
  partitionCleanCloudOrders,
  type CleanCloudOrderRow,
} from "./paidOrderLedger";
import { reconcilePaidRevenue } from "./canonicalRevenue";

export const HISTORICAL_SALES_CONTROLS = {
  orders: 533,
  revenue: 492,
  revenueCents: 2724697,
  ordersOnly: 41,
  refundId: "141",
  refundCents: -1000,
} as const;

/** Local source witness only. No customer identifiers, names or raw rows escape. */
export function certifyHistoricalSales(input: {
  ordersCsv: string;
  revenueCsv: string;
}) {
  const normalize = (csv: string, type: "orders_sales" | "orders_revenue") =>
    parseCsv(csv, type).map((row: Record<string, string>) => {
      const result = normalizeCleanCloudPaidOrderRow(row, {
        tenantId: "certificate",
        sourceReportType: type,
        sourceFileName: "local-private-export",
        importBatchId: 0,
      });
      if (!result.normalized)
        throw new Error(`Historical ${type} source row rejected`);
      return result.normalized;
    });
  const orders = normalize(input.ordersCsv, "orders_sales");
  const revenue = normalize(input.revenueCsv, "orders_revenue");
  const orderById = new Map(orders.map(row => [row.cleancloudOrderId, row]));
  const revenueIds = new Set(revenue.map(row => row.cleancloudOrderId));
  const missing = [...revenueIds].filter(id => !orderById.has(id));
  const revenueCents = revenue.reduce(
    (sum, row) => sum + (row.totalCents ?? 0),
    0
  );
  const ordersNetCents = [...revenueIds].reduce(
    (sum, id) => sum + (orderById.get(id)?.totalCents ?? 0),
    0
  );
  const rows = [...orders, ...revenue] as CleanCloudOrderRow[];
  const ledger = partitionCleanCloudOrders(
    rows,
    {
      startUtc: new Date("2000-01-01"),
      endExclusiveUtc: new Date("2100-01-01"),
    },
    "America/Los_Angeles"
  );
  const book = reconcilePaidRevenue({
    events: ledger.events,
    provenExclusions: ledger.provenDuplicateExclusions,
  });
  const refund = orderById.get(HISTORICAL_SALES_CONTROLS.refundId);
  const undatedAdjustments = orders.filter(
    row => row.paid && (row.totalCents ?? 0) < 0 && !row.paymentDateUtc
  );
  const twinCount = ledger.provenDuplicateExclusions.length;
  const ordersOnly = orders.filter(
    row => !revenueIds.has(row.cleancloudOrderId)
  );
  const checks = {
    orders: orders.length === 533 && orderById.size === 533,
    revenue: revenue.length === 492 && revenueIds.size === 492,
    subset: missing.length === 0,
    money: revenueCents === 2724697 && ordersNetCents === revenueCents && revenue.every(row => orderById.get(row.cleancloudOrderId)?.totalCents === row.totalCents),
    twins:
      twinCount === 492 &&
      new Set(book.includedEvents.map(event => event.eventKey)).size ===
        book.includedEvents.length,
    ordersOnly: ordersOnly.length === 41,
    refund: Boolean(
      refund?.paid &&
        refund.totalCents === -1000 &&
        /refund/i.test(refund.summaryText ?? "")
    ),
  };
  const dates = orders
    .map(row => row.placedAtUtc?.toISOString())
    .filter((date): date is string => Boolean(date))
    .sort();
  const payments = book.includedEvents
    .map(event => event.occurredAt.toISOString())
    .sort();
  return {
    version: 1,
    kind: "attached_source_certificate",
    passed: Object.values(checks).every(Boolean),
    checks,
    source: {
      orders: {
        rows: orders.length,
        uniqueIds: orderById.size,
        digest: createHash("sha256").update(input.ordersCsv).digest("hex"),
      },
      revenue: {
        rows: revenue.length,
        uniqueIds: revenueIds.size,
        digest: createHash("sha256").update(input.revenueCsv).digest("hex"),
      },
      missingRevenueIds: missing.length,
      earliestOrder: dates[0] ?? null,
      latestOrder: dates.at(-1) ?? null,
    },
    money: {
      expectedRevenueCents: HISTORICAL_SALES_CONTROLS.revenueCents,
      revenueCents,
      ordersNetCents,
      differenceCents: revenueCents - HISTORICAL_SALES_CONTROLS.revenueCents,
      datedPaidBookCents: book.exactIncludedCents,
    },
    reconciliation: {
      twins: twinCount,
      ordersOnly: ordersOnly.length,
      ordersOnlyPaidCents: ordersOnly
        .filter(row => row.paid)
        .reduce((sum, row) => sum + (row.totalCents ?? 0), 0),
      refundAccounted: checks.refund,
      undatedAdjustments: {
        count: undatedAdjustments.length,
        cents: undatedAdjustments.reduce(
          (sum, row) => sum + (row.totalCents ?? 0),
          0
        ),
      },
      duplicateCounting:
        book.includedEvents.length -
        new Set(book.includedEvents.map(event => event.eventKey)).size,
    },
    coverage: {
      latestPayment: payments.at(-1) ?? null,
      status: "attached_sources_only",
      productionFreshness: "unverified",
    },
    crossSystem: {
      status: "not_observed",
      provenDuplicatePairs: null,
      provenDistinctPairs: null,
      unresolvedPairs: null,
      withheldCents: null,
    },
    claireReader: { status: "requires_live_acceptance" },
  };
}
