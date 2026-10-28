import { eq } from "drizzle-orm";
import { legacyDayforgeSaasTenantLocations } from "../../drizzle/schema";
import {
  percentChange,
  type AccountSnapshot,
  type AccountSnapshotMetric,
  type AccountSnapshotPeriod,
  type AccountSnapshotPrecision,
} from "../../shared/accountSnapshot";
import { getDashboardTimeZone, zonedDayStartUtc } from "../dashboardZoned";
import { getDb } from "../db";
import { addDaysYmd, ALL_TIME_START, freezePeriod, previousPeriod, resolvePeriod, type ResolvedPeriod } from "./businessPeriods";
import { defaultBusinessQuery, defaultBusinessQueryDeps, runBusinessQuery, type BusinessQueryDeps } from "./businessQuery";
import { loadRevenueSourceCoverage, readCanonicalRevenue, type CanonicalRevenueResult } from "./canonicalRevenue";
import { loadPaidOrderLedger } from "./paidOrderLedger";
import type { BusinessSourceCoverageSnapshot } from "./sourceCoverage";

/**
 * Week to date and month to date for the main account page.
 *
 * Revenue and paid orders are the canonical paid-revenue read (`readCanonicalRevenue`), the same one the business
 * overview states. New customers are the canonical business query's `new_customers` (first paid order ever falls in
 * the period), over one full-history ledger load. Periods and their comparisons come from `businessPeriods`.
 *
 * A figure the read cannot license is null. A zero is returned only when coverage proves it exact.
 */

export type AccountSnapshotDeps = {
  now: () => Date;
  timeZone: () => string;
  readRevenue: (input: {
    tenantId: string;
    from: string;
    to: string;
    timeZone: string;
    now: Date;
    coverage: BusinessSourceCoverageSnapshot | null;
  }) => Promise<CanonicalRevenueResult>;
  loadLedger: BusinessQueryDeps["loadLedger"];
  readSourceCoverage: (input: { tenantId: string; now: Date }) => Promise<BusinessSourceCoverageSnapshot | null>;
  loadCity: (tenantId: string) => Promise<string | null>;
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "1234 Sunset Blvd, Los Angeles, CA 90026" → "Los Angeles". Null unless a city sits right before "ST 12345". */
export function cityFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const parts = address.split(",").map(part => part.trim()).filter(Boolean);
  for (let i = 2; i < parts.length; i += 1) {
    if (/^[A-Z]{2}(\s+\d{5}(-\d{4})?)?$/.test(parts[i]!)) {
      const city = parts[i - 1]!;
      return /^[A-Za-z][A-Za-z .'-]{1,60}$/.test(city) ? city : null;
    }
  }
  return null;
}

async function loadPrimaryLocationCity(tenantId: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ address: legacyDayforgeSaasTenantLocations.address, isPrimary: legacyDayforgeSaasTenantLocations.isPrimary })
    .from(legacyDayforgeSaasTenantLocations)
    .where(eq(legacyDayforgeSaasTenantLocations.tenantId, tenantId));
  const primary = rows.find(row => row.isPrimary) ?? rows[0];
  return cityFromAddress(primary?.address);
}

export const defaultAccountSnapshotDeps: AccountSnapshotDeps = {
  now: () => new Date(),
  timeZone: getDashboardTimeZone,
  readRevenue: input => readCanonicalRevenue(input),
  loadLedger: loadPaidOrderLedger,
  readSourceCoverage: input => loadRevenueSourceCoverage(input),
  loadCity: loadPrimaryLocationCity,
};

type Sourced = { value: number | null; precision: AccountSnapshotPrecision };

const UNAVAILABLE: Sourced = { value: null, precision: "unavailable" };

/** An unproven zero is not a zero: it is withheld. */
function sourced(value: number, exact: boolean): Sourced {
  if (exact) return { value, precision: "exact" };
  return value === 0 ? UNAVAILABLE : { value, precision: "recorded" };
}

function metric(current: Sourced, previous: Sourced): AccountSnapshotMetric {
  return {
    value: current.value,
    previous: previous.value,
    changePct: percentChange(current.value, previous.value),
    precision: current.precision,
  };
}

function revenueOf(read: CanonicalRevenueResult): { revenueCents: Sourced; orders: Sourced } {
  if (read.status !== "ok") return { revenueCents: UNAVAILABLE, orders: UNAVAILABLE };
  return {
    revenueCents: sourced(read.mayStateExact ? (read.statedExactCents ?? read.recordedCents) : read.recordedCents, read.mayStateExact),
    orders: sourced(read.exactIncludedOrderCount, read.mayStateExact),
  };
}

export async function readAccountSnapshot(input: {
  tenantId: string;
  deps?: Partial<AccountSnapshotDeps>;
}): Promise<AccountSnapshot> {
  const deps: AccountSnapshotDeps = { ...defaultAccountSnapshotDeps, ...input.deps };
  const now = deps.now();
  const timeZone = deps.timeZone();
  const week = resolvePeriod({ kind: "this_week" }, now, timeZone);
  const month = resolvePeriod({ kind: "this_month" }, now, timeZone);
  const spans = { week, previousWeek: previousPeriod(week, now), month, previousMonth: previousPeriod(month, now) };

  const coverage = await deps.readSourceCoverage({ tenantId: input.tenantId, now }).catch(() => null);
  const revenue = async (span: ResolvedPeriod) => {
    try {
      return revenueOf(await deps.readRevenue({ tenantId: input.tenantId, from: span.start, to: span.end, timeZone, now, coverage }));
    } catch (error) {
      console.warn("[AccountSnapshot] revenue read failed", error instanceof Error ? error.message : error);
      return { revenueCents: UNAVAILABLE, orders: UNAVAILABLE };
    }
  };

  // One full-history ledger serves every new-customer span: "new" means no paid order on record before the span.
  const ledgerOnce = (() => {
    let pending: ReturnType<BusinessQueryDeps["loadLedger"]> | null = null;
    return () =>
      (pending ??= deps.loadLedger({
        tenantId: input.tenantId,
        startUtc: zonedDayStartUtc(ALL_TIME_START, timeZone),
        endExclusiveUtc: zonedDayStartUtc(addDaysYmd(week.end, 1), timeZone),
        timeZone,
      }));
  })();
  const businessDeps: BusinessQueryDeps = {
    ...defaultBusinessQueryDeps,
    now: () => now,
    timeZone: () => timeZone,
    loadLedger: () => ledgerOnce(),
    readSourceCoverage: async () => coverage,
  };
  const newCustomers = async (span: ResolvedPeriod): Promise<Sourced> => {
    const result = await runBusinessQuery(input.tenantId, { ...defaultBusinessQuery("new_customers"), period: freezePeriod(span), comparison: null }, businessDeps);
    if (result.status !== "ok" || result.data.kind !== "customers") return UNAVAILABLE;
    const complete = result.coverage?.completeness === "complete" && result.coverage.failedSources.length === 0 && coverage?.book.status === "fresh";
    return sourced(result.data.population.count, complete);
  };

  const [weekRevenue, previousWeekRevenue, monthRevenue, previousMonthRevenue, weekNew, previousWeekNew, monthNew, previousMonthNew, city] =
    await Promise.all([
      revenue(spans.week),
      revenue(spans.previousWeek),
      revenue(spans.month),
      revenue(spans.previousMonth),
      newCustomers(spans.week),
      newCustomers(spans.previousWeek),
      newCustomers(spans.month),
      newCustomers(spans.previousMonth),
      deps.loadCity(input.tenantId).catch(() => null),
    ]);

  const period = (
    key: AccountSnapshotPeriod["key"],
    current: ResolvedPeriod,
    previous: ResolvedPeriod,
    reads: [Awaited<ReturnType<typeof revenue>>, Awaited<ReturnType<typeof revenue>>, Sourced, Sourced]
  ): AccountSnapshotPeriod => ({
    key,
    label: key === "week" ? "Week to date" : "Month to date",
    start: current.start,
    end: current.end,
    comparison: { start: previous.start, end: previous.end, label: previous.label },
    revenueCents: metric(reads[0].revenueCents, reads[1].revenueCents),
    orders: metric(reads[0].orders, reads[1].orders),
    newCustomers: metric(reads[2], reads[3]),
  });

  return {
    generatedAt: now.toISOString(),
    timeZone,
    today: week.end,
    monthName: MONTH_NAMES[Number(month.start.slice(5, 7)) - 1]!,
    city,
    week: period("week", spans.week, spans.previousWeek, [weekRevenue, previousWeekRevenue, weekNew, previousWeekNew]),
    month: period("month", spans.month, spans.previousMonth, [monthRevenue, previousMonthRevenue, monthNew, previousMonthNew]),
  };
}
