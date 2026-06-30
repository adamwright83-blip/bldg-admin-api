/**
 * Demo datasource — a SEPARATE fixture database for sales demos.
 * Never mixed into production queries. Functions mirror live query signatures exactly.
 *
 * Represents a healthy mid-sized laundromat:
 *   ~$4,280/week revenue, ~87 orders/week, ~1,214 lbs/week,
 *   ~12 open orders, ~8 awaiting payment, ~34% repeat customers.
 */

import type {
  DateRange,
  RevenueSummary,
  OrderStats,
  OpenOrderStats,
  RepeatCustomerStats,
  MetricComparison,
  DataCompleteness,
} from "./analyticsQueries";

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysBetween(range: DateRange): number {
  return Math.max(
    1,
    Math.round((Date.parse(range.end) - Date.parse(range.start)) / 864e5) + 1
  );
}

function buckets(range: DateRange, groupBy: "day" | "week" | "month"): string[] {
  const start = new Date(range.start + "T00:00:00Z");
  const end = new Date(range.end + "T00:00:00Z");
  const out: string[] = [];
  const cur = new Date(start);

  while (cur <= end) {
    if (groupBy === "day") {
      out.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    } else if (groupBy === "week") {
      // Advance to Monday
      const dayOfWeek = cur.getUTCDay();
      const daysToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const mon = new Date(cur);
      mon.setUTCDate(mon.getUTCDate() + daysToMon);
      out.push(mon.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 7);
    } else {
      out.push(cur.toISOString().slice(0, 7));
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
  }
  return Array.from(new Set(out));
}

// Deterministic "noise" per bucket so numbers look realistic, not flat.
function pseudoRandom(seed: string, min: number, max: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  const frac = ((h >>> 0) % 1000) / 1000;
  return min + frac * (max - min);
}

// ── Query mirror fns ─────────────────────────────────────────────────────────

const DAILY_REVENUE = 611; // $4,280 / 7
const DAILY_ORDERS = 12.4; // ~87 / 7

export function demoRevenueSummary(
  _tenantId: string,
  params: { range: DateRange; groupBy: "day" | "week" | "month"; basis?: "paidAt" | "createdAt" }
): RevenueSummary {
  const bs = buckets(params.range, params.groupBy);
  const days = daysBetween(params.range);
  const mult = params.groupBy === "week" ? 7 : params.groupBy === "month" ? 30 : 1;

  const series = bs.map((b) => {
    const noise = pseudoRandom(b, 0.75, 1.28);
    const revenue = Math.round(DAILY_REVENUE * mult * noise * 100) / 100;
    const orderCount = Math.max(1, Math.round(DAILY_ORDERS * mult * noise));
    return { bucket: b, revenue, orderCount };
  });

  const totalRevenue = Math.round(series.reduce((a, s) => a + s.revenue, 0) * 100) / 100;
  const orderCount = series.reduce((a, s) => a + s.orderCount, 0);

  return {
    totalRevenue,
    orderCount,
    avgOrderValue: orderCount > 0 ? Math.round((totalRevenue / orderCount) * 100) / 100 : 0,
    series,
  };
}

export function demoOrderStats(
  _tenantId: string,
  params: { range: DateRange; serviceType?: "wash_fold" | "dry_cleaning"; status?: string }
): OrderStats {
  const days = daysBetween(params.range);
  const totalOrders = Math.round(DAILY_ORDERS * days);

  const wfCount = Math.round(totalOrders * 0.78);
  const dcCount = totalOrders - wfCount;

  const byServiceType: Record<string, number> = params.serviceType
    ? { [params.serviceType]: params.serviceType === "wash_fold" ? wfCount : dcCount }
    : { wash_fold: wfCount, dry_cleaning: dcCount };

  const deliveredPct = 0.62;
  const byStatus: Record<string, number> = params.status
    ? { [params.status]: Math.round(totalOrders * 0.3) }
    : {
        delivered: Math.round(totalOrders * deliveredPct),
        processing: Math.round(totalOrders * 0.12),
        ready: Math.round(totalOrders * 0.08),
        collected: Math.round(totalOrders * 0.07),
        new: Math.round(totalOrders * 0.06),
        cancelled: Math.round(totalOrders * 0.05),
      };

  return {
    totalOrders,
    byStatus,
    byServiceType,
    totalWeightLbs: Math.round(wfCount * 13.9 * 10) / 10, // ~13.9 lbs / wf order
    avgOrderValue: 49.2,
  };
}

export function demoOpenOrderStats(_tenantId: string): OpenOrderStats {
  return {
    openTotal: 12,
    byStatus: { new: 2, collected: 4, processing: 4, ready: 2 },
    awaitingPayment: 8,
  };
}

export function demoRepeatCustomerStats(
  _tenantId: string,
  _params: { range: DateRange }
): RepeatCustomerStats {
  return {
    totalCustomers: 58,
    repeatCustomers: 20,
    oneTimeCustomers: 38,
    repeatRate: 0.34,
  };
}

export function demoMetricComparison(
  _tenantId: string,
  params: { metricId: string; currentRange: DateRange; groupBy: "day" | "week" | "month"; basis?: string }
): MetricComparison {
  const metricId = params.metricId ?? "revenue_paid_stripe";

  // Non-revenue metric comparisons
  if (metricId === "orders_created") {
    return {
      unit: "count", current: 87, previous: 82, absChange: 5,
      pctChange: Math.round((5 / 82) * 10000) / 100,
      currentOrders: 0, previousOrders: 0, currentAov: 0, previousAov: 0,
      volumeEffect: 0, aovEffect: 0, driversByServiceType: [],
    };
  }
  if (metricId === "orders_paid") {
    return {
      unit: "count", current: 83, previous: 79, absChange: 4,
      pctChange: Math.round((4 / 79) * 10000) / 100,
      currentOrders: 0, previousOrders: 0, currentAov: 0, previousAov: 0,
      volumeEffect: 0, aovEffect: 0, driversByServiceType: [],
    };
  }
  if (metricId === "avg_order_value") {
    return {
      unit: "currency", current: 49.2, previous: 48.4, absChange: 0.8,
      pctChange: Math.round((0.8 / 48.4) * 10000) / 100,
      currentOrders: 0, previousOrders: 0, currentAov: 0, previousAov: 0,
      volumeEffect: 0, aovEffect: 0, driversByServiceType: [],
    };
  }
  if (metricId === "wash_fold_weight") {
    return {
      unit: "weight_lbs", current: 1214, previous: 1150, absChange: 64,
      pctChange: Math.round((64 / 1150) * 10000) / 100,
      currentOrders: 0, previousOrders: 0, currentAov: 0, previousAov: 0,
      volumeEffect: 0, aovEffect: 0, driversByServiceType: [],
    };
  }

  // Default: revenue_paid_stripe
  const curRevenue = 4280;
  const prevRevenue = 3968;
  const curOrders = 87;
  const prevOrders = 82;
  const curAov = 49.2;
  const prevAov = 48.4;

  return {
    unit: "currency",
    current: curRevenue,
    previous: prevRevenue,
    absChange: curRevenue - prevRevenue,
    pctChange: Math.round(((curRevenue - prevRevenue) / prevRevenue) * 10000) / 100,
    currentOrders: curOrders,
    previousOrders: prevOrders,
    currentAov: curAov,
    previousAov: prevAov,
    volumeEffect: Math.round((curOrders - prevOrders) * prevAov * 100) / 100,
    aovEffect: Math.round((curAov - prevAov) * curOrders * 100) / 100,
    driversByServiceType: [
      { key: "wash_fold", cur: 68, prev: 64, delta: 4 },
      { key: "dry_cleaning", cur: 19, prev: 18, delta: 1 },
    ],
  };
}

export function demoDataCompleteness(_tenantId: string): DataCompleteness {
  return {
    connected: [
      { source: "Stripe-paid orders", description: "Revenue, order volume, avg order value" },
    ],
    missing: [
      { source: "Payroll / labor", prevents: "cannot calculate labor margin or labor-cost percentage" },
      { source: "Machine revenue (coin-op)", prevents: "cannot calculate full store revenue" },
      { source: "Cash drawer / POS", prevents: "cannot reconcile total daily sales across all payment types" },
      { source: "Supply costs (detergent, bags, hangers)", prevents: "cannot calculate true gross profit" },
    ],
  };
}
