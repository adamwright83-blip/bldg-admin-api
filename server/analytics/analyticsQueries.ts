import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { orders, cleancloudPaidOrders, clearentTransactions } from "../../drizzle/schema";

export type DateRange = { start: string; end: string }; // ISO yyyy-mm-dd inclusive

export type RevenuePoint = { bucket: string; revenue: number; orderCount: number };

export type RevenueSummary = {
  totalRevenue: number;
  orderCount: number;
  avgOrderValue: number;
  series: RevenuePoint[];
};

export type OrderStats = {
  totalOrders: number;
  byStatus: Record<string, number>;
  byServiceType: Record<string, number>;
  totalWeightLbs: number;
  avgOrderValue: number;
};

export type OpenOrderStats = {
  openTotal: number;
  byStatus: Record<string, number>;
  awaitingPayment: number;
};

export type RepeatCustomerStats = {
  totalCustomers: number;
  repeatCustomers: number;
  oneTimeCustomers: number;
  repeatRate: number;
};

export type MetricComparison = {
  current: number;
  previous: number;
  absChange: number;
  pctChange: number;
  currentOrders: number;
  previousOrders: number;
  currentAov: number;
  previousAov: number;
  volumeEffect: number;
  aovEffect: number;
  driversByServiceType: Array<{ key: string; cur: number; prev: number; delta: number }>;
};

export type DataCompleteness = {
  connected: Array<{ source: string; description: string }>;
  missing: Array<{ source: string; prevents: string }>;
};

/**
 * Revenue totals + time series for paid orders within a date range.
 * basis defaults to "paidAt". groupBy controls time bucket granularity.
 *
 * MySQL date-bucketing:
 *   day   -> DATE(col)
 *   week  -> DATE(col - INTERVAL WEEKDAY(col) DAY)  Monday-anchored
 *   month -> DATE_FORMAT(col, '%Y-%m')
 */
export async function getRevenueSummary(
  tenantId: string,
  params: {
    range: DateRange;
    groupBy: "day" | "week" | "month";
    basis?: "paidAt" | "createdAt";
  }
): Promise<RevenueSummary> {
  const db = await getDb();
  if (!db) return { totalRevenue: 0, orderCount: 0, avgOrderValue: 0, series: [] };

  const col = params.basis === "createdAt" ? orders.createdAt : orders.paidAt;

  const bucketExpr =
    params.groupBy === "day"
      ? sql<string>`DATE(${col})`
      : params.groupBy === "week"
        ? sql<string>`DATE(${col} - INTERVAL WEEKDAY(${col}) DAY)`
        : sql<string>`DATE_FORMAT(${col}, '%Y-%m')`;

  const rows = await db
    .select({
      bucket: bucketExpr,
      revenue: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
      orderCount: sql<number>`COUNT(*)`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, tenantId),
        sql`${orders.paid} = true`,
        sql`DATE(${col}) >= ${params.range.start}`,
        sql`DATE(${col}) <= ${params.range.end}`
      )
    )
    .groupBy(bucketExpr)
    .orderBy(bucketExpr);

  const series: RevenuePoint[] = rows.map((r) => ({
    bucket: String(r.bucket ?? ""),
    revenue: Number(r.revenue),
    orderCount: Number(r.orderCount),
  }));

  const totalRevenue = series.reduce((acc, p) => acc + p.revenue, 0);
  const orderCount = series.reduce((acc, p) => acc + p.orderCount, 0);

  return {
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    orderCount,
    avgOrderValue: orderCount > 0 ? Math.round((totalRevenue / orderCount) * 100) / 100 : 0,
    series,
  };
}

/**
 * Order volume, status mix, service-type mix, and lbs for a date range.
 * Uses createdAt (orders exist before payment).
 */
export async function getOrderStats(
  tenantId: string,
  params: {
    range: DateRange;
    serviceType?: "wash_fold" | "dry_cleaning";
    status?: string;
  }
): Promise<OrderStats> {
  const db = await getDb();
  if (!db) {
    return { totalOrders: 0, byStatus: {}, byServiceType: {}, totalWeightLbs: 0, avgOrderValue: 0 };
  }

  const conditions = [
    eq(orders.tenantId, tenantId),
    sql`DATE(${orders.createdAt}) >= ${params.range.start}`,
    sql`DATE(${orders.createdAt}) <= ${params.range.end}`,
  ];
  if (params.serviceType) conditions.push(eq(orders.serviceType, params.serviceType));
  if (params.status) conditions.push(sql`${orders.status} = ${params.status}`);

  const rows = await db
    .select({
      status: orders.status,
      serviceType: orders.serviceType,
      total: orders.total,
      weightLbs: orders.weightLbs,
    })
    .from(orders)
    .where(and(...conditions));

  const byStatus: Record<string, number> = {};
  const byServiceType: Record<string, number> = {};
  let totalWeightLbs = 0;
  let totalRevenue = 0;

  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    byServiceType[row.serviceType] = (byServiceType[row.serviceType] ?? 0) + 1;
    if (row.weightLbs != null) totalWeightLbs += Number(row.weightLbs);
    totalRevenue += Number(row.total ?? 0);
  }

  return {
    totalOrders: rows.length,
    byStatus,
    byServiceType,
    totalWeightLbs: Math.round(totalWeightLbs * 10) / 10,
    avgOrderValue: rows.length > 0 ? Math.round((totalRevenue / rows.length) * 100) / 100 : 0,
  };
}

/** Active orders snapshot (not delivered / not cancelled). */
export async function getOpenOrderStats(tenantId: string): Promise<OpenOrderStats> {
  const db = await getDb();
  if (!db) return { openTotal: 0, byStatus: {}, awaitingPayment: 0 };

  const rows = await db
    .select({ status: orders.status, paid: orders.paid })
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, tenantId),
        sql`${orders.status} NOT IN ('delivered', 'cancelled')`
      )
    );

  const byStatus: Record<string, number> = {};
  let awaitingPayment = 0;

  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    if (!row.paid && ["collected", "processing", "ready"].includes(row.status)) {
      awaitingPayment++;
    }
  }

  return { openTotal: rows.length, byStatus, awaitingPayment };
}

/** Distinct customers: repeat (≥2 orders) vs first-time within the date range. */
export async function getRepeatCustomerStats(
  tenantId: string,
  params: { range: DateRange }
): Promise<RepeatCustomerStats> {
  const db = await getDb();
  if (!db) return { totalCustomers: 0, repeatCustomers: 0, oneTimeCustomers: 0, repeatRate: 0 };

  const rows = await db
    .select({
      phone: orders.phone,
      orderCount: sql<number>`COUNT(*)`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, tenantId),
        sql`DATE(${orders.createdAt}) >= ${params.range.start}`,
        sql`DATE(${orders.createdAt}) <= ${params.range.end}`
      )
    )
    .groupBy(orders.phone);

  const totalCustomers = rows.length;
  const repeatCustomers = rows.filter((r) => Number(r.orderCount) >= 2).length;
  const oneTimeCustomers = totalCustomers - repeatCustomers;

  return {
    totalCustomers,
    repeatCustomers,
    oneTimeCustomers,
    repeatRate: totalCustomers > 0 ? Math.round((repeatCustomers / totalCustomers) * 100) / 100 : 0,
  };
}

/**
 * Price/volume decomposition: compares currentRange vs comparisonRange for revenue.
 * comparisonRange defaults to the equal-length period immediately preceding currentRange.
 *
 * Bridge identities:
 *   volumeEffect  = (orders_cur - orders_prev) * aov_prev
 *   aovEffect     = (aov_cur - aov_prev) * orders_cur
 *   sum ≈ absChange (within rounding)
 */
export async function getMetricComparison(
  tenantId: string,
  params: {
    currentRange: DateRange;
    comparisonRange?: DateRange;
    groupBy: "day" | "week" | "month";
    basis?: "paidAt" | "createdAt";
  }
): Promise<MetricComparison> {
  const empty = (): MetricComparison => ({
    current: 0, previous: 0, absChange: 0, pctChange: 0,
    currentOrders: 0, previousOrders: 0, currentAov: 0, previousAov: 0,
    volumeEffect: 0, aovEffect: 0, driversByServiceType: [],
  });

  const db = await getDb();
  if (!db) return empty();

  // Compute comparisonRange as previous equal-length period if not supplied.
  const compRange = params.comparisonRange ?? previousEqualPeriod(params.currentRange);

  const [cur, prev] = await Promise.all([
    getRevenueSummary(tenantId, { range: params.currentRange, groupBy: params.groupBy, basis: params.basis }),
    getRevenueSummary(tenantId, { range: compRange, groupBy: params.groupBy, basis: params.basis }),
  ]);

  const [curStats, prevStats] = await Promise.all([
    getOrderStats(tenantId, { range: params.currentRange }),
    getOrderStats(tenantId, { range: compRange }),
  ]);

  const absChange = Math.round((cur.totalRevenue - prev.totalRevenue) * 100) / 100;
  const pctChange =
    prev.totalRevenue > 0
      ? Math.round(((cur.totalRevenue - prev.totalRevenue) / prev.totalRevenue) * 10000) / 100
      : 0;

  const volumeEffect = Math.round((cur.orderCount - prev.orderCount) * (prev.avgOrderValue ?? 0) * 100) / 100;
  const aovEffect = Math.round((cur.avgOrderValue - prev.avgOrderValue) * cur.orderCount * 100) / 100;

  // Per-service-type revenue comparison (order count as proxy since we have total per type).
  const allServiceTypes = new Set([
    ...Object.keys(curStats.byServiceType),
    ...Object.keys(prevStats.byServiceType),
  ]);
  const driversByServiceType = Array.from(allServiceTypes).map((key) => ({
    key,
    cur: curStats.byServiceType[key] ?? 0,
    prev: prevStats.byServiceType[key] ?? 0,
    delta: (curStats.byServiceType[key] ?? 0) - (prevStats.byServiceType[key] ?? 0),
  }));

  return {
    current: cur.totalRevenue,
    previous: prev.totalRevenue,
    absChange,
    pctChange,
    currentOrders: cur.orderCount,
    previousOrders: prev.orderCount,
    currentAov: cur.avgOrderValue,
    previousAov: prev.avgOrderValue,
    volumeEffect,
    aovEffect,
    driversByServiceType,
  };
}

function previousEqualPeriod(range: DateRange): DateRange {
  const start = Date.parse(range.start);
  const end = Date.parse(range.end);
  const span = end - start; // ms
  const prevEnd = new Date(start - 1).toISOString().slice(0, 10);
  const prevStart = new Date(start - 1 - span).toISOString().slice(0, 10);
  return { start: prevStart, end: prevEnd };
}

/**
 * Brutally honest data-completeness report.
 * Connected = we have actual rows for this tenant.
 * Missing   = what absence prevents (upsell lever).
 */
export async function getDataCompleteness(tenantId: string): Promise<DataCompleteness> {
  const db = await getDb();

  const connected: DataCompleteness["connected"] = [];
  const missing: DataCompleteness["missing"] = [];

  if (db) {
    // Stripe-paid orders
    const [paidRow] = await db
      .select({ cnt: sql<number>`COUNT(*)` })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), sql`${orders.paid} = true`));
    if (Number(paidRow?.cnt ?? 0) > 0) {
      connected.push({ source: "Stripe-paid orders", description: "Revenue, order volume, avg order value" });
    } else {
      missing.push({ source: "Stripe-paid orders", prevents: "cannot calculate any revenue or order volume" });
    }

    // CleanCloud import
    const [ccRow] = await db
      .select({ cnt: sql<number>`COUNT(*)` })
      .from(cleancloudPaidOrders)
      .where(eq(cleancloudPaidOrders.tenantId, tenantId));
    if (Number(ccRow?.cnt ?? 0) > 0) {
      connected.push({ source: "CleanCloud import", description: "Legacy order history imported" });
    }

    // Clearent / XplorPay — no tenantId column; check if any rows exist globally
    const [clearRow] = await db
      .select({ cnt: sql<number>`COUNT(*)` })
      .from(clearentTransactions);
    if (Number(clearRow?.cnt ?? 0) > 0) {
      connected.push({ source: "Clearent / XplorPay", description: "Card-reader transactions imported" });
    }
  }

  // Always-missing categories (not yet connected in any tenant).
  missing.push(
    { source: "Payroll / labor", prevents: "cannot calculate labor margin or labor-cost percentage" },
    { source: "Machine revenue (coin-op)", prevents: "cannot calculate full store revenue" },
    { source: "Cash drawer / POS", prevents: "cannot reconcile total daily sales across all payment types" },
    { source: "Supply costs (detergent, bags, hangers)", prevents: "cannot calculate true gross profit" }
  );

  return { connected, missing };
}
