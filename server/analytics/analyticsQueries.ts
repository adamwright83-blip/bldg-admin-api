import { and, eq, gte, lte, sql, sum, count } from "drizzle-orm";
import { getDb } from "../db";
import { orders } from "../../drizzle/schema";

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

/**
 * Revenue totals + time series for paid orders within a date range.
 * basis defaults to "paidAt". groupBy controls time bucket granularity.
 *
 * MySQL date-bucketing notes:
 *   day   -> DATE(col)                    e.g. "2025-06-01"
 *   week  -> DATE(col - INTERVAL WEEKDAY(col) DAY)  Monday-anchored ISO week start
 *   month -> DATE_FORMAT(col, '%Y-%m')    e.g. "2025-06"
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
    return {
      totalOrders: 0,
      byStatus: {},
      byServiceType: {},
      totalWeightLbs: 0,
      avgOrderValue: 0,
    };
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
