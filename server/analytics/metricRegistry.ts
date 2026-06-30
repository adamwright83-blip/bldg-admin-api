export type MetricUnit = "currency" | "count" | "weight_lbs";

export type QueryMeta = {
  source: string;
  basis: string; // composite e.g. "paidAt + createdAt + current open-order snapshot"
  includedSources: string[];
  excludedSources: string[];
  tenantId: string;
  demoMode: boolean;
  generatedAt: string; // ISO timestamp
};

export type MetricDef = {
  id: string;
  label: string;
  unit: MetricUnit;
  dateBasis: "paidAt" | "createdAt";
  snapshot?: boolean; // true for metrics that are current-state snapshots (open_orders, awaiting_payment)
  includedSources: string[];
  excludedSources: string[];
  allowedGroupBy: Array<"day" | "week" | "month">;
  allowedChartTypes: Array<"bar" | "line" | "area" | "pie">;
  supportsComparison: boolean;
  resolver: string;
};

// Shared source strings — canonical; used in meta receipts and completeness scanner.
export const STRIPE_INCLUDED = [
  "Orders marked paid in admin (Stripe/native)",
  "Column: orders.paid=true, orders.total",
];
export const STRIPE_EXCLUDED = [
  "Legacy CleanCloud imports (separate table)",
  "Clearent / XplorPay transactions",
  "Cash drawer / unrecorded POS sales",
];
export const CREATED_INCLUDED = [
  "All orders created in admin system",
  "Column: orders.createdAt",
];
export const CREATED_EXCLUDED = [
  "External POS orders not entered in admin",
  "Cash drop-offs not recorded",
];

export const METRICS: Record<string, MetricDef> = {
  revenue_paid_stripe: {
    id: "revenue_paid_stripe",
    label: "Paid revenue",
    unit: "currency",
    dateBasis: "paidAt",
    includedSources: STRIPE_INCLUDED,
    excludedSources: STRIPE_EXCLUDED,
    allowedGroupBy: ["day", "week", "month"],
    allowedChartTypes: ["bar", "line", "area"],
    supportsComparison: true,
    resolver: "getRevenueSummary",
  },
  orders_created: {
    id: "orders_created",
    label: "Orders created",
    unit: "count",
    dateBasis: "createdAt",
    includedSources: CREATED_INCLUDED,
    excludedSources: CREATED_EXCLUDED,
    allowedGroupBy: ["day", "week", "month"],
    allowedChartTypes: ["bar", "line"],
    supportsComparison: true,
    resolver: "getOrderStats",
  },
  orders_paid: {
    id: "orders_paid",
    label: "Paid orders",
    unit: "count",
    dateBasis: "paidAt",
    includedSources: STRIPE_INCLUDED,
    excludedSources: STRIPE_EXCLUDED,
    allowedGroupBy: ["day", "week", "month"],
    allowedChartTypes: ["bar", "line"],
    supportsComparison: true,
    resolver: "getRevenueSummary",
  },
  avg_order_value: {
    id: "avg_order_value",
    label: "Average order value",
    unit: "currency",
    dateBasis: "paidAt",
    includedSources: STRIPE_INCLUDED,
    excludedSources: STRIPE_EXCLUDED,
    allowedGroupBy: ["day", "week", "month"],
    allowedChartTypes: ["bar", "line"],
    supportsComparison: true,
    resolver: "getRevenueSummary",
  },
  open_orders: {
    id: "open_orders",
    label: "Open orders",
    unit: "count",
    dateBasis: "createdAt",
    snapshot: true,
    includedSources: ["Active orders: new, collected, processing, ready"],
    excludedSources: ["Delivered and cancelled orders"],
    allowedGroupBy: [],
    allowedChartTypes: ["pie", "bar"],
    supportsComparison: false,
    resolver: "getOpenOrderStats",
  },
  awaiting_payment: {
    id: "awaiting_payment",
    label: "Awaiting payment",
    unit: "count",
    dateBasis: "createdAt",
    snapshot: true,
    includedSources: ["Orders in collected/processing/ready with paid=false"],
    excludedSources: ["New orders not yet intaken", "Paid orders"],
    allowedGroupBy: [],
    allowedChartTypes: ["bar"],
    supportsComparison: false,
    resolver: "getOpenOrderStats",
  },
  wash_fold_weight: {
    id: "wash_fold_weight",
    label: "Wash & fold lbs processed",
    unit: "weight_lbs",
    dateBasis: "createdAt",
    includedSources: ["orders.weightLbs where serviceType=wash_fold"],
    excludedSources: ["Dry cleaning (counted by garment, not weight)"],
    allowedGroupBy: ["day", "week", "month"],
    allowedChartTypes: ["bar"],
    supportsComparison: true,
    resolver: "getOrderStats",
  },
  service_mix: {
    id: "service_mix",
    label: "Service mix",
    unit: "count",
    dateBasis: "createdAt",
    includedSources: CREATED_INCLUDED,
    excludedSources: CREATED_EXCLUDED,
    allowedGroupBy: [],
    allowedChartTypes: ["pie", "bar"],
    supportsComparison: false,
    resolver: "getOrderStats",
  },
  repeat_customer_count: {
    id: "repeat_customer_count",
    label: "Repeat customers",
    unit: "count",
    dateBasis: "createdAt",
    includedSources: ["Distinct phone numbers with ≥2 orders in period"],
    excludedSources: CREATED_EXCLUDED,
    allowedGroupBy: [],
    allowedChartTypes: ["bar"],
    supportsComparison: false,
    resolver: "getRepeatCustomerStats",
  },
  top_customer_revenue: {
    id: "top_customer_revenue",
    label: "Top customers by paid revenue",
    unit: "currency",
    dateBasis: "paidAt",
    includedSources: [
      "Orders marked paid in admin (Stripe/native)",
      "Grouped by customer name and phone",
      "Columns: orders.firstName, orders.lastName, orders.phone, orders.total",
    ],
    excludedSources: STRIPE_EXCLUDED,
    allowedGroupBy: [],
    allowedChartTypes: ["bar"],
    supportsComparison: false,
    resolver: "getTopCustomersByRevenue",
  },
};

export const METRIC_IDS = Object.keys(METRICS);

export function getMetric(id: string): MetricDef | undefined {
  return METRICS[id];
}

/** Builds deterministic provenance meta from the selected metrics.
 *  Called by the composer — LLM output for `meta` is always discarded.
 *  Patch 1: basis is now a composite string covering all date/snapshot bases used. */
export function buildQueryMeta(
  metricIds: string[],
  tenantId: string,
  demoMode: boolean
): QueryMeta {
  const defs = metricIds.map((id) => METRICS[id]).filter((d): d is MetricDef => Boolean(d));
  const primary = defs[0];
  const allIncluded = Array.from(new Set(defs.flatMap((d) => d.includedSources)));
  const allExcluded = Array.from(new Set(defs.flatMap((d) => d.excludedSources)));

  // Collect distinct basis labels preserving order.
  const basisLabels: string[] = [];
  for (const def of defs) {
    const label = def.snapshot ? "current open-order snapshot" : def.dateBasis;
    if (!basisLabels.includes(label)) basisLabels.push(label);
  }

  return {
    source: primary?.label ?? "Laundromat analytics",
    basis: basisLabels.join(" + ") || "createdAt",
    includedSources: allIncluded,
    excludedSources: allExcluded,
    tenantId,
    demoMode,
    generatedAt: new Date().toISOString(),
  };
}
