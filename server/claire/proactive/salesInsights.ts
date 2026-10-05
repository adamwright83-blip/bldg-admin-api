import { createHash } from "node:crypto";
import {
  defaultBusinessQuery,
  runBusinessQuery,
  type BusinessQueryResult,
} from "../../analytics/businessQuery";
import { businessToday } from "../../analytics/businessPeriods";
import { getDashboardTimeZone } from "../../dashboardZoned";

export type SalesInsightArtifact = {
  kind: "sales_trend";
  observationReference: string;
  scope: "Laundry Farm total" | "CleanCloud recorded sales";
  metric: "net_paid_revenue_cents";
  period: { from: string; to: string };
  comparisonPeriod: { from: string; to: string };
  precision: "exact";
  speech: string;
  series: Array<{ from: string; to: string; cents: number }>;
};

/** Speech and artifact share the very same canonical result. No model chooses money. */
export function selectSalesInsight(
  result: BusinessQueryResult,
  today: string,
  history?: BusinessQueryResult
): SalesInsightArtifact | null {
  if (
    result.status !== "ok" ||
    result.data.kind !== "totals" ||
    !result.data.previous ||
    !result.comparisonPeriod
  )
    return null;
  if (
    !result.coverage?.canonicalRevenue?.mayStateExact ||
    result.coverage.canonicalRevenue.comparisonMayStateExact !== true ||
    result.period.end >= today ||
    result.comparisonPeriod.end >= today
  )
    return null;
  const monthComplete = (from: string, to: string) =>
    from.endsWith("-01") &&
    new Date(Date.parse(`${to}T00:00:00Z`) + 86400000)
      .toISOString()
      .slice(8, 10) === "01";
  if (
    !monthComplete(result.period.start, result.period.end) ||
    !monthComplete(result.comparisonPeriod.start, result.comparisonPeriod.end)
  )
    return null;
  const current = result.data.current.revenueCents,
    previous = result.data.previous.revenueCents;
  if (previous <= 0 || Math.abs(current - previous) < 5000) return null;
  const percent = Math.round(((current - previous) / previous) * 1000) / 10;
  if (Math.abs(percent) < 20) return null;
  const scope =
    result.query.filters?.sources?.length === 1 &&
    result.query.filters.sources[0] === "cleancloud"
      ? "CleanCloud recorded sales"
      : "Laundry Farm total";
  const strongest =
    history?.status === "ok" &&
    history.data.kind === "period_ranking" &&
    history.coverage?.canonicalRevenue?.mayStateExact &&
    history.data.rows.length >= 2 &&
    history.data.rows[0]?.key === result.period.start.slice(0, 7) &&
    history.data.rows[0].revenueCents === current;
  const series = [
    {
      from: result.comparisonPeriod.start,
      to: result.comparisonPeriod.end,
      cents: previous,
    },
    { from: result.period.start, to: result.period.end, cents: current },
  ];
  const observationReference = `sales-trend:${createHash("sha256").update(JSON.stringify({ scope, series, canonicalObservation: result.coverage?.observationReference })).digest("hex")}`;
  return {
    kind: "sales_trend",
    observationReference,
    scope,
    metric: "net_paid_revenue_cents",
    precision: "exact",
    period: { from: result.period.start, to: result.period.end },
    comparisonPeriod: {
      from: result.comparisonPeriod.start,
      to: result.comparisonPeriod.end,
    },
    series,
    speech: `${result.period.label} closed at $${(current / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })} in ${scope === "Laundry Farm total" ? "Laundry Farm paid revenue" : "CleanCloud paid revenue"}${strongest ? ", the strongest completed month in recorded history," : ","} ${Math.abs(percent)}% ${percent > 0 ? "above" : "below"} ${result.comparisonPeriod.label}.`,
  };
}

export async function loadSalesInsight(
  tenantId: string,
  now = new Date(),
  timeZone = getDashboardTimeZone()
): Promise<SalesInsightArtifact | null> {
  const query = {
    ...defaultBusinessQuery("revenue"),
    period: { kind: "last_month" as const },
    comparison: "previous" as const,
  };
  const today = businessToday(now, timeZone);
  for (const filters of [null, { sources: ["cleancloud" as const] }]) {
    const result = await runBusinessQuery(tenantId, { ...query, filters });
    if (!selectSalesInsight(result, today)) continue;
    const history = await runBusinessQuery(tenantId, {
      ...defaultBusinessQuery("period_ranking"),
      filters,
      period: { kind: "between", start: "2020-01-01", end: result.period.end },
      limit: 2,
    });
    return selectSalesInsight(result, today, history);
  }
  return null;
}
