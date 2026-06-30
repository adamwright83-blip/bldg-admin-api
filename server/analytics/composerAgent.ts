import { invokeLLM } from "../_core/llm";
import { ENV } from "../_core/env";
import {
  getRevenueSummary,
  getOrderStats,
  getOpenOrderStats,
  getRepeatCustomerStats,
  getMetricComparison,
  getDataCompleteness,
} from "./analyticsQueries";
import type {
  DateRange,
  RevenueSummary,
  OrderStats,
  OpenOrderStats,
  RepeatCustomerStats,
  MetricComparison,
  DataCompleteness,
} from "./analyticsQueries";
import {
  demoRevenueSummary,
  demoOrderStats,
  demoOpenOrderStats,
  demoRepeatCustomerStats,
  demoMetricComparison,
  demoDataCompleteness,
} from "./demoDataset";
import { METRIC_IDS, METRICS, buildQueryMeta } from "./metricRegistry";
import type { QueryMeta } from "./metricRegistry";
import { ACTION_IDS, mapActionIds } from "./actionCatalog";
import type { ActionDef } from "./actionCatalog";

// ── Public types ──────────────────────────────────────────────────────────────

export type HistoryMessage = { role: "user" | "assistant"; content: string };

export type ComposerChart = {
  type: "bar" | "line" | "area" | "pie";
  title: string;
  xKey: string;
  series: Array<{ key: string; label: string }>;
  data: Array<Record<string, string | number>>;
};

export type ComposerTable = {
  columns: string[];
  rows: Array<Array<string | number>>;
};

export type ComposerHeadline = {
  label: string;
  value: string;
  delta?: { direction: "up" | "down" | "flat"; pct: number; label: string };
  subStats?: Array<{ label: string; value: string }>;
};

export type ComposerAnswer = {
  answer: string;
  headline: ComposerHeadline | null;
  chart: ComposerChart | null;
  table: ComposerTable | null;
  actions: ActionDef[];
  meta: QueryMeta & { dateRange: DateRange };
};

// ── Analytics source abstraction (live vs demo) ───────────────────────────────

type AnalyticsSource = {
  getRevenueSummary: (
    tenantId: string,
    params: { range: DateRange; groupBy: "day" | "week" | "month"; basis?: "paidAt" | "createdAt" }
  ) => Promise<RevenueSummary> | RevenueSummary;
  getOrderStats: (
    tenantId: string,
    params: { range: DateRange; serviceType?: "wash_fold" | "dry_cleaning"; status?: string }
  ) => Promise<OrderStats> | OrderStats;
  getOpenOrderStats: (tenantId: string) => Promise<OpenOrderStats> | OpenOrderStats;
  getRepeatCustomerStats: (
    tenantId: string,
    params: { range: DateRange }
  ) => Promise<RepeatCustomerStats> | RepeatCustomerStats;
  getMetricComparison: (
    tenantId: string,
    params: { metricId: string; currentRange: DateRange; comparisonRange?: DateRange; groupBy: "day" | "week" | "month"; basis?: "paidAt" | "createdAt" }
  ) => Promise<MetricComparison> | MetricComparison;
  getDataCompleteness: (tenantId: string) => Promise<DataCompleteness> | DataCompleteness;
};

const liveSource: AnalyticsSource = {
  getRevenueSummary,
  getOrderStats,
  getOpenOrderStats,
  getRepeatCustomerStats,
  getMetricComparison,
  getDataCompleteness,
};

const demoSource: AnalyticsSource = {
  getRevenueSummary: (t, p) => Promise.resolve(demoRevenueSummary(t, p)),
  getOrderStats: (t, p) => Promise.resolve(demoOrderStats(t, p)),
  getOpenOrderStats: (t) => Promise.resolve(demoOpenOrderStats(t)),
  getRepeatCustomerStats: (t, p) => Promise.resolve(demoRepeatCustomerStats(t, p)),
  getMetricComparison: (t, p) => Promise.resolve(demoMetricComparison(t, p)),
  getDataCompleteness: (t) => Promise.resolve(demoDataCompleteness(t)),
};

// ── Dependency injection ──────────────────────────────────────────────────────

export type ComposerDeps = {
  invokeLLM: typeof invokeLLM;
  liveSource: AnalyticsSource;
  demoSource: AnalyticsSource;
};

export const defaultComposerDeps: ComposerDeps = {
  invokeLLM,
  liveSource,
  demoSource,
};

// ── Date validation / clamping (Step 2) ───────────────────────────────────────

export function normalizeRange(range: { start?: string; end?: string }): DateRange {
  // Patch 7: strict ISO date validation with round-trip — reject impossible dates like 2026-02-31
  // that Date.parse normalizes silently (would become 2026-03-03).
  const isISO = (s?: string): s is string => {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const parsed = new Date(s + "T00:00:00Z");
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === s;
  };

  const today = new Date();
  const fallbackEnd = today.toISOString().slice(0, 10);
  const fallbackStart = new Date(today.getTime() - 6 * 864e5).toISOString().slice(0, 10);

  let start = isISO(range.start) ? range.start : fallbackStart;
  let end = isISO(range.end) ? range.end : fallbackEnd;

  if (start > end) [start, end] = [end, start]; // swap reversed

  const spanDays = (Date.parse(end) - Date.parse(start)) / 864e5;
  if (spanDays > 366) {
    start = new Date(Date.parse(end) - 366 * 864e5).toISOString().slice(0, 10);
  }

  return { start, end };
}

// ── History → single user block (Step 1 bug fix) ──────────────────────────────

function historyMessages(history: HistoryMessage[]): Array<{ role: "user"; content: string }> {
  const recent = history.slice(-8);
  if (!recent.length) return [];
  const transcript = recent
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");
  return [{ role: "user" as const, content: `Previous conversation:\n${transcript}` }];
}

// ── Pass-1 schema: LLM picks metric IDs from registry ────────────────────────

type PlannerOutput = {
  metricIds: string[];
  range: { start: string; end: string };
  groupBy: "day" | "week" | "month";
  compareToPrevious: boolean;
  intent: "single" | "comparison" | "summary" | "completeness";
};

const plannerSchema = {
  name: "query_plan",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["metricIds", "range", "groupBy", "compareToPrevious", "intent"],
    properties: {
      metricIds: {
        type: "array",
        items: { type: "string" },
      },
      range: {
        type: "object",
        additionalProperties: false,
        required: ["start", "end"],
        properties: {
          start: { type: "string" },
          end: { type: "string" },
        },
      },
      groupBy: { type: "string", enum: ["day", "week", "month"] },
      compareToPrevious: { type: "boolean" },
      intent: { type: "string", enum: ["single", "comparison", "summary", "completeness"] },
    },
  },
};

// ── Pass-2 schema: LLM writes the narrative and picks chart type / actions ────

type AnswererOutput = {
  answer: string;
  chartType: "bar" | "line" | "area" | "pie" | "none";
  actionIds: string[];
  headlineLabel: string;
};

const answererSchema = {
  name: "composer_answer",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["answer", "chartType", "actionIds", "headlineLabel"],
    properties: {
      answer: { type: "string" },
      chartType: { type: "string", enum: ["bar", "line", "area", "pie", "none"] },
      actionIds: { type: "array", items: { type: "string" } },
      headlineLabel: { type: "string" },
    },
  },
};

// ── Backend chart/table/headline builders (never from LLM) ───────────────────

type QueryResults = {
  revenue: RevenueSummary | null;
  stats: OrderStats | null;
  openOrders: OpenOrderStats | null;
  repeatCustomers: RepeatCustomerStats | null;
  comparison: MetricComparison | null;
  completeness: DataCompleteness | null;
};

function formatCurrency(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Format a value according to metric unit — used in comparison headline/table. */
import type { MetricUnit } from "./metricRegistry";
function formatValue(unit: MetricUnit, n: number): string {
  if (unit === "currency") return formatCurrency(n);
  if (unit === "weight_lbs") return `${n} lbs`;
  return String(n);
}

function buildChart(
  results: QueryResults,
  chartType: "bar" | "line" | "area" | "pie",
  metricIds: string[]
): ComposerChart | null {

  // Comparison chart — must come BEFORE revenue time series so comparison questions
  // render current-vs-previous, not the raw revenue series.
  if (results.comparison) {
    const c = results.comparison;
    const unit = c.unit ?? "currency";
    const valueLabel =
      unit === "count" ? "Count" : unit === "weight_lbs" ? "Lbs" : "Revenue ($)";
    return {
      type: "bar",
      title: "Current vs previous period",
      xKey: "period",
      series: [{ key: "value", label: valueLabel }],
      data: [
        { period: "Previous", value: c.previous },
        { period: "Current", value: c.current },
      ],
    };
  }

  // Revenue time series (only for non-comparison revenue questions)
  if (results.revenue?.series.length) {
    return {
      type: chartType,
      title: "Revenue over time",
      xKey: "bucket",
      series: [
        { key: "revenue", label: "Revenue ($)" },
        { key: "orderCount", label: "Orders" },
      ],
      data: results.revenue.series.map((p) => ({
        bucket: p.bucket,
        revenue: p.revenue,
        orderCount: p.orderCount,
      })),
    };
  }

  // Service mix
  if (results.stats?.byServiceType && Object.keys(results.stats.byServiceType).length > 0) {
    return {
      type: chartType,
      title: "Service mix",
      xKey: "serviceType",
      series: [{ key: "count", label: "Orders" }],
      data: Object.entries(results.stats.byServiceType).map(([key, count]) => ({
        serviceType: key === "wash_fold" ? "Wash & Fold" : "Dry Cleaning",
        count,
      })),
    };
  }

  // Open orders by status
  if (results.openOrders && Object.keys(results.openOrders.byStatus).length > 0) {
    return {
      type: "pie",
      title: "Open orders by status",
      xKey: "status",
      series: [{ key: "count", label: "Orders" }],
      data: Object.entries(results.openOrders.byStatus).map(([status, count]) => ({
        status,
        count,
      })),
    };
  }

  return null;
}

function buildTable(results: QueryResults): ComposerTable | null {
  // Completeness first — most explicit/intentional request
  if (results.completeness) {
    const { connected, missing } = results.completeness;
    return {
      columns: ["Source", "Status", "Notes"],
      rows: [
        ...connected.map((c) => [c.source, "✓ Connected", c.description]),
        ...missing.map((m) => [m.source, "✗ Not connected", m.prevents]),
      ],
    };
  }

  // Comparison table — must come before revenue series
  if (results.comparison) {
    const c = results.comparison;
    const unit = c.unit ?? "currency";
    const dir = c.absChange > 0 ? "▲" : c.absChange < 0 ? "▼" : "—";
    const rows: Array<Array<string | number>> = [
      [
        unit === "currency" ? "Revenue" : unit === "weight_lbs" ? "Weight (lbs)" : "Count",
        formatValue(unit, c.current),
        formatValue(unit, c.previous),
        `${dir} ${formatValue(unit, Math.abs(c.absChange))} (${c.pctChange > 0 ? "+" : ""}${c.pctChange}%)`,
      ],
    ];
    // Revenue bridge rows only for currency metric
    if (unit === "currency" && (c.currentOrders > 0 || c.previousOrders > 0)) {
      rows.push(
        ["Orders", String(c.currentOrders), String(c.previousOrders), String(c.currentOrders - c.previousOrders)],
        ["Avg order value", formatCurrency(c.currentAov), formatCurrency(c.previousAov), `${dir} ${formatCurrency(Math.abs(c.currentAov - c.previousAov))}`],
        ["Volume effect", "", "", formatCurrency(c.volumeEffect)],
        ["AOV effect", "", "", formatCurrency(c.aovEffect)],
      );
    }
    return { columns: ["Metric", "This period", "Previous period", "Change"], rows };
  }

  // Revenue time series table
  if (results.revenue?.series.length) {
    return {
      columns: ["Date", "Revenue", "Orders"],
      rows: results.revenue.series.map((p) => [p.bucket, formatCurrency(p.revenue), p.orderCount]),
    };
  }

  // Service mix table
  if (results.stats?.byServiceType && Object.keys(results.stats.byServiceType).length > 0) {
    const rows: Array<Array<string | number>> = [];
    for (const [key, count] of Object.entries(results.stats.byServiceType)) {
      rows.push([key === "wash_fold" ? "Wash & Fold" : "Dry Cleaning", count]);
    }
    if (results.stats.totalWeightLbs > 0) {
      rows.push(["Total lbs (W&F)", results.stats.totalWeightLbs]);
    }
    return { columns: ["Service", "Orders"], rows };
  }

  // Open orders table
  if (results.openOrders) {
    const o = results.openOrders;
    return {
      columns: ["Metric", "Count"],
      rows: [
        ["Total open orders", o.openTotal],
        ["Awaiting payment", o.awaitingPayment],
        ...Object.entries(o.byStatus).map(([s, n]) => [`Status: ${s}`, n]),
      ],
    };
  }

  // Repeat customer table
  if (results.repeatCustomers) {
    const r = results.repeatCustomers;
    return {
      columns: ["Metric", "Count"],
      rows: [
        ["Total customers", r.totalCustomers],
        ["Repeat (≥2 orders)", r.repeatCustomers],
        ["First-time", r.oneTimeCustomers],
        ["Repeat rate", `${Math.round(r.repeatRate * 100)}%`],
      ],
    };
  }

  return null;
}

function buildHeadline(results: QueryResults, headlineLabel: string): ComposerHeadline | null {
  if (results.comparison) {
    const c = results.comparison;
    const unit = c.unit ?? "currency";
    const direction: "up" | "down" | "flat" =
      c.absChange > 0 ? "up" : c.absChange < 0 ? "down" : "flat";
    // Revenue bridge subStats only for currency
    const subStats: Array<{ label: string; value: string }> =
      unit === "currency" && c.currentOrders > 0
        ? [
            { label: "Orders", value: String(c.currentOrders) },
            { label: "Avg order", value: formatCurrency(c.currentAov) },
          ]
        : [];
    return {
      label: headlineLabel || (unit === "currency" ? "Revenue" : unit === "weight_lbs" ? "Lbs processed" : "Count"),
      value: formatValue(unit, c.current),
      delta: {
        direction,
        pct: Math.abs(c.pctChange),
        label: `${Math.abs(c.pctChange)}% vs prior period`,
      },
      subStats: subStats.length ? subStats : undefined,
    };
  }

  if (results.revenue && results.revenue.totalRevenue > 0) {
    return {
      label: headlineLabel || "Paid revenue",
      value: formatCurrency(results.revenue.totalRevenue),
      subStats: [
        { label: "Orders", value: String(results.revenue.orderCount) },
        { label: "Avg order", value: formatCurrency(results.revenue.avgOrderValue) },
      ],
    };
  }

  if (results.openOrders) {
    return {
      label: headlineLabel || "Open orders",
      value: String(results.openOrders.openTotal),
      subStats: [{ label: "Awaiting payment", value: String(results.openOrders.awaitingPayment) }],
    };
  }

  if (results.stats && results.stats.totalOrders > 0) {
    return {
      label: headlineLabel || "Orders",
      value: String(results.stats.totalOrders),
      subStats:
        results.stats.totalWeightLbs > 0
          ? [{ label: "Lbs processed", value: `${results.stats.totalWeightLbs} lbs` }]
          : undefined,
    };
  }

  return null;
}

// ── Metric execution engine ───────────────────────────────────────────────────

async function executeMetrics(
  tenantId: string,
  plan: PlannerOutput,
  range: DateRange,
  source: AnalyticsSource
): Promise<QueryResults> {
  const results: QueryResults = {
    revenue: null,
    stats: null,
    openOrders: null,
    repeatCustomers: null,
    comparison: null,
    completeness: null,
  };

  const ids = new Set(plan.metricIds);

  const needsRevenue = ids.has("revenue_paid_stripe") || ids.has("orders_paid") || ids.has("avg_order_value");
  const needsStats = ids.has("orders_created") || ids.has("wash_fold_weight") || ids.has("service_mix");
  const needsOpen = ids.has("open_orders") || ids.has("awaiting_payment");
  const needsRepeat = ids.has("repeat_customer_count");
  const needsCompleteness = plan.intent === "completeness";
  const needsComparison = plan.compareToPrevious;

  const groupBy = plan.groupBy;

  const [revenue, stats, openOrders, repeatCustomers, comparison, completeness] =
    await Promise.all([
      needsRevenue
        ? source.getRevenueSummary(tenantId, { range, groupBy })
        : Promise.resolve(null),
      needsStats
        ? source.getOrderStats(tenantId, { range })
        : Promise.resolve(null),
      needsOpen
        ? source.getOpenOrderStats(tenantId)
        : Promise.resolve(null),
      needsRepeat
        ? source.getRepeatCustomerStats(tenantId, { range })
        : Promise.resolve(null),
      needsComparison
        ? source.getMetricComparison(tenantId, {
            metricId: plan.metricIds.find((id) => METRICS[id]?.supportsComparison) ?? "revenue_paid_stripe",
            currentRange: range,
            groupBy,
          })
        : Promise.resolve(null),
      needsCompleteness
        ? source.getDataCompleteness(tenantId)
        : Promise.resolve(null),
    ]);

  results.revenue = revenue;
  results.stats = stats;
  results.openOrders = openOrders;
  results.repeatCustomers = repeatCustomers;
  results.comparison = comparison;
  results.completeness = completeness;

  return results;
}

// ── Board-meeting mode preset (Step 8) ────────────────────────────────────────

export async function runBoardMeetingSummary(
  {
    tenantId,
    period = "this_week",
    demoMode = false,
  }: { tenantId: string; period?: "this_week"; demoMode?: boolean },
  deps: ComposerDeps = defaultComposerDeps
): Promise<ComposerAnswer> {
  const today = new Date();
  const model = ENV.anthropicModel;
  const source = demoMode ? deps.demoSource : deps.liveSource;

  // Monday of this week → today
  const dayOfWeek = today.getUTCDay();
  const daysToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekStart = new Date(today);
  weekStart.setUTCDate(today.getUTCDate() + daysToMon);
  const range: DateRange = {
    start: weekStart.toISOString().slice(0, 10),
    end: today.toISOString().slice(0, 10),
  };

  const fixedMetricIds = [
    "revenue_paid_stripe",
    "orders_paid",
    "avg_order_value",
    "open_orders",
    "awaiting_payment",
    "service_mix",
  ];

  const [revenue, stats, openOrders, comparison] = await Promise.all([
    source.getRevenueSummary(tenantId, { range, groupBy: "day" }),
    source.getOrderStats(tenantId, { range }),
    source.getOpenOrderStats(tenantId),
    source.getMetricComparison(tenantId, { metricId: "revenue_paid_stripe", currentRange: range, groupBy: "day" }),
  ]);

  const results: QueryResults = {
    revenue,
    stats,
    openOrders,
    comparison,
    repeatCustomers: null,
    completeness: null,
  };

  const dataContext = JSON.stringify({ revenue, stats, openOrders, comparison, period, range });

  const answerResult = await deps.invokeLLM({
    tenantId,
    model,
    temperature: 0,
    maxTokens: 1200,
    outputSchema: answererSchema,
    messages: [
      {
        role: "system",
        content: [
          `You are an Operator Analyst for a laundromat. Today is ${today.toISOString().slice(0, 10)}.`,
          "You are writing a weekly board summary. Only reference numbers from queryResults — never invent.",
          "answer: 3-5 sentences covering revenue, volume, and the single most important operational item.",
          "chartType: choose bar (weekly revenue comparison vs prior week).",
          "headlineLabel: 'This week so far'",
          "actionIds: pick 1-2 most relevant from: " + ACTION_IDS.join(", "),
        ].join("\n"),
      },
      { role: "user", content: `Weekly summary request. Query results:\n${dataContext}` },
    ],
  });

  const answerContent = answerResult.choices[0]?.message.content;
  const llmOutput: AnswererOutput = JSON.parse(
    typeof answerContent === "string" ? answerContent : JSON.stringify(answerContent)
  );

  const meta: QueryMeta & { dateRange: DateRange } = {
    ...buildQueryMeta(fixedMetricIds, tenantId, demoMode),
    dateRange: range,
  };

  return {
    answer: llmOutput.answer,
    headline: buildHeadline(results, "This week so far"),
    chart: buildChart(results, "bar", fixedMetricIds),
    table: buildTable(results),
    actions: mapActionIds(llmOutput.actionIds ?? []),
    meta,
  };
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runComposerTurn(
  {
    tenantId,
    question,
    history,
    mode,
    demoMode = false,
  }: {
    tenantId: string;
    question: string;
    history: HistoryMessage[];
    mode?: "summary";
    demoMode?: boolean;
  },
  deps: ComposerDeps = defaultComposerDeps
): Promise<ComposerAnswer> {
  if (mode === "summary") {
    return runBoardMeetingSummary({ tenantId, demoMode }, deps);
  }

  const today = new Date().toISOString().slice(0, 10);
  const model = ENV.anthropicModel;
  const source = demoMode ? deps.demoSource : deps.liveSource;

  // ── Pass 1: LLM picks metric IDs + date range + intent ────────────────────
  const planResult = await deps.invokeLLM({
    tenantId,
    model,
    temperature: 0,
    maxTokens: 600,
    outputSchema: plannerSchema,
    messages: [
      {
        role: "system",
        content: [
          `You are a query planner for an Operator Analyst system for a laundromat. Today is ${today}.`,
          `Available metric IDs: ${METRIC_IDS.join(", ")}`,
          "Pick the smallest set of metricIds that answers the question.",
          "revenue_paid_stripe/orders_paid/avg_order_value: money/revenue/sales questions.",
          "orders_created/service_mix/wash_fold_weight: volume, mix, lbs questions.",
          "open_orders/awaiting_payment: current open order snapshot.",
          "repeat_customer_count: loyalty/repeat questions.",
          "compareToPrevious: true when the question asks about change, trends, 'vs', 'compared to', 'why'.",
          "intent='completeness' for: 'what can you tell me?', 'what data do you have?', 'does this include cash?'",
          "groupBy: 'day' for ≤14 days, 'week' for ≤90 days, 'month' for >90 days.",
          "Default date range to last 7 days when unspecified.",
        ].join("\n"),
      },
      ...historyMessages(history),
      { role: "user", content: question },
    ],
  });

  const planContent = planResult.choices[0]?.message.content;
  const rawPlan: PlannerOutput = JSON.parse(
    typeof planContent === "string" ? planContent : JSON.stringify(planContent)
  );

  // Validate metric IDs against registry (drop unknown ones, fallback to revenue).
  const validMetricIds = rawPlan.metricIds.filter((id) => METRICS[id]);
  const metricIds = validMetricIds.length > 0 ? validMetricIds : ["revenue_paid_stripe"];
  const plan: PlannerOutput = { ...rawPlan, metricIds };

  // Clamp/validate date range.
  const range = normalizeRange(plan.range);

  // ── Execute queries (tenantId always from ctx, never from LLM) ────────────
  const results = await executeMetrics(tenantId, plan, range, source);

  // ── Build data structures deterministically ────────────────────────────────
  const dataContext = JSON.stringify({
    revenue: results.revenue,
    stats: results.stats,
    openOrders: results.openOrders,
    repeatCustomers: results.repeatCustomers,
    comparison: results.comparison,
    completeness: results.completeness,
    dateRange: range,
    groupBy: plan.groupBy,
  });

  const allowedChartTypes = metricIds
    .flatMap((id) => METRICS[id]?.allowedChartTypes ?? [])
    .filter((v, i, a) => a.indexOf(v) === i);

  // ── Pass 2: LLM writes narrative + picks chart type + action IDs ──────────
  const answerResult = await deps.invokeLLM({
    tenantId,
    model,
    temperature: 0,
    maxTokens: 1000,
    outputSchema: answererSchema,
    messages: [
      {
        role: "system",
        content: [
          `You are an Operator Analyst for a laundromat. Today is ${today}.`,
          "Only state figures present in queryResults — never estimate or invent numbers.",
          "answer: 1-3 plain-English sentences. Format dollars as $1,482.75.",
          `chartType: choose from ${allowedChartTypes.length ? allowedChartTypes.join(", ") : "bar, line, area, pie"}, or 'none' if data is empty.`,
          "headlineLabel: short label for the main metric (e.g. 'Revenue last 7 days').",
          `actionIds: 0-2 most relevant from: ${ACTION_IDS.join(", ")}. Empty array if none relevant.`,
          "If completeness data is present, explain what is and is not connected — be honest about gaps.",
          "If comparison data is present, explain whether the change was driven by volume or pricing.",
        ].join("\n"),
      },
      ...historyMessages(history),
      { role: "user", content: question },
      { role: "user", content: `Query results:\n${dataContext}` },
    ],
  });

  const answerContent = answerResult.choices[0]?.message.content;
  const llmOutput: AnswererOutput = JSON.parse(
    typeof answerContent === "string" ? answerContent : JSON.stringify(answerContent)
  );

  // ── Assemble final answer — backend owns all numbers and meta ─────────────
  // Patch 3: Clamp chartType against allowedChartTypes before calling buildChart.
  // Backend enforces this; LLM output is only a hint.
  let chartType: "bar" | "line" | "area" | "pie" | "none" = llmOutput.chartType ?? "bar";
  if (chartType !== "none") {
    if (allowedChartTypes.length === 0) {
      chartType = "none";
    } else if (!allowedChartTypes.includes(chartType as "bar" | "line" | "area" | "pie")) {
      chartType = allowedChartTypes[0];
    }
  }
  const chart = chartType === "none" ? null : buildChart(results, chartType, metricIds);
  const table = buildTable(results);
  const headline = buildHeadline(results, llmOutput.headlineLabel ?? "");
  const actions = mapActionIds(llmOutput.actionIds ?? []);

  // Meta is always backend-built; LLM never writes it.
  const meta: QueryMeta & { dateRange: DateRange } = {
    ...buildQueryMeta(metricIds, tenantId, demoMode),
    dateRange: range,
  };

  return { answer: llmOutput.answer, headline, chart, table, actions, meta };
}
