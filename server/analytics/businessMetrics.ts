import { addDaysYmd } from "./businessPeriods";
import { resolveCustomerIdentities } from "./customerIdentityResolution";
import type { LedgerSource, PaidOrderEvent, ServiceType } from "./paidOrderLedger";

/** Pure computations over the paid-order ledger. No I/O, no formatting. */

export type DateSpan = { start: string; end: string };

export type RevenueTotals = {
  revenueCents: number;
  orderCount: number;
  aovCents: number | null;
};

export function eventsInSpan(
  events: readonly PaidOrderEvent[],
  span: DateSpan,
  serviceType: ServiceType | null = null
): PaidOrderEvent[] {
  return events.filter(
    event =>
      event.businessDate >= span.start &&
      event.businessDate <= span.end &&
      (!serviceType || event.serviceType === serviceType)
  );
}

export function summarizeTotals(events: readonly PaidOrderEvent[]): RevenueTotals {
  const revenueCents = events.reduce((sum, event) => sum + event.cents, 0);
  return {
    revenueCents,
    orderCount: events.length,
    aovCents: events.length ? Math.round(revenueCents / events.length) : null,
  };
}

export type TotalsComparison = {
  current: RevenueTotals;
  previous: RevenueTotals;
  revenueChangeCents: number;
  revenueChangePct: number | null;
  orderChange: number;
  orderChangePct: number | null;
  aovChangeCents: number | null;
  /** Revenue change explained by order count at the previous AOV. */
  volumeEffectCents: number | null;
  /** Revenue change explained by AOV movement at the current order count. */
  aovEffectCents: number | null;
};

function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function compareTotals(current: RevenueTotals, previous: RevenueTotals): TotalsComparison {
  return {
    current,
    previous,
    revenueChangeCents: current.revenueCents - previous.revenueCents,
    revenueChangePct: pctChange(current.revenueCents, previous.revenueCents),
    orderChange: current.orderCount - previous.orderCount,
    orderChangePct: pctChange(current.orderCount, previous.orderCount),
    aovChangeCents:
      current.aovCents != null && previous.aovCents != null ? current.aovCents - previous.aovCents : null,
    volumeEffectCents:
      previous.aovCents != null ? (current.orderCount - previous.orderCount) * previous.aovCents : null,
    aovEffectCents:
      current.aovCents != null && previous.aovCents != null
        ? (current.aovCents - previous.aovCents) * current.orderCount
        : null,
  };
}

export type SeriesPoint = { bucket: string; revenueCents: number; orderCount: number };

function weekStart(ymd: string): string {
  const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return addDaysYmd(ymd, dow === 0 ? -6 : 1 - dow);
}

export function bucketSeries(
  events: readonly PaidOrderEvent[],
  groupBy: "day" | "week" | "month"
): SeriesPoint[] {
  const buckets = new Map<string, SeriesPoint>();
  for (const event of events) {
    const bucket =
      groupBy === "day" ? event.businessDate : groupBy === "week" ? weekStart(event.businessDate) : event.businessDate.slice(0, 7);
    const point = buckets.get(bucket) ?? { bucket, revenueCents: 0, orderCount: 0 };
    point.revenueCents += event.cents;
    point.orderCount += 1;
    buckets.set(bucket, point);
  }
  return Array.from(buckets.values()).sort((a, b) => a.bucket.localeCompare(b.bucket));
}

// ── Customers ────────────────────────────────────────────────────────────────

export type CustomerSummary = {
  identityId: string;
  displayName: string;
  /** False when the order carried no phone, email, resident id, or CleanCloud id. */
  matched: boolean;
  orderCount: number;
  revenueCents: number;
  firstOrderDate: string | null;
  lastOrderDate: string | null;
  sources: LedgerSource[];
};

export type CustomerPopulation = {
  count: number;
  members: CustomerSummary[];
  /** Members that are a single unidentifiable order counted as its own customer. */
  unmatchedCount: number;
};

type CustomerGroup = { identityId: string; matched: boolean; records: PaidOrderEvent[] };

function groupCustomers(events: readonly PaidOrderEvent[]): CustomerGroup[] {
  return resolveCustomerIdentities(events, event => event.identity).groups.map(group => ({
    identityId: group.id,
    matched: group.matched,
    records: group.records,
  }));
}

function summarize(group: CustomerGroup, records: readonly PaidOrderEvent[]): CustomerSummary {
  const sorted = [...records].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const named = [...group.records]
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .find(record => record.customerName);
  return {
    identityId: group.identityId,
    displayName: named?.customerName ?? "an unnamed customer",
    matched: group.matched,
    orderCount: sorted.length,
    revenueCents: sorted.reduce((sum, record) => sum + record.cents, 0),
    firstOrderDate: sorted[0]?.businessDate ?? null,
    lastOrderDate: sorted[sorted.length - 1]?.businessDate ?? null,
    sources: Array.from(new Set(sorted.map(record => record.source))),
  };
}

function population(members: CustomerSummary[]): CustomerPopulation {
  return {
    count: members.length,
    members,
    unmatchedCount: members.filter(member => !member.matched).length,
  };
}

function byRevenue(a: CustomerSummary, b: CustomerSummary): number {
  return b.revenueCents - a.revenueCents || b.orderCount - a.orderCount || a.displayName.localeCompare(b.displayName);
}

/** Customers with at least `minOrders` paid orders inside `span`. */
export function activeCustomerPopulation(
  historyEvents: readonly PaidOrderEvent[],
  span: DateSpan,
  minOrders = 1
): CustomerPopulation {
  const members = groupCustomers(historyEvents)
    .map(group => ({ group, inSpan: eventsInSpan(group.records, span) }))
    .filter(({ inSpan }) => inSpan.length >= Math.max(1, minOrders))
    .map(({ group, inSpan }) => summarize(group, inSpan))
    .sort(byRevenue);
  return population(members);
}

/**
 * Active customers in `span` who had no paid order between `lookbackStart`
 * and the day before the span. "New" is relative to that lookback, not
 * proven first-ever.
 */
export function newCustomerPopulation(
  historyEvents: readonly PaidOrderEvent[],
  span: DateSpan,
  lookbackStart: string,
  minOrders = 1
): CustomerPopulation & { activeCount: number } {
  const before = { start: lookbackStart, end: addDaysYmd(span.start, -1) };
  const groups = groupCustomers(historyEvents).map(group => ({
    group,
    inSpan: eventsInSpan(group.records, span),
    prior: eventsInSpan(group.records, before),
  }));
  const active = groups.filter(({ inSpan }) => inSpan.length >= Math.max(1, minOrders));
  const members = active
    .filter(({ prior }) => prior.length === 0)
    .map(({ group, inSpan }) => summarize(group, inSpan))
    .sort(byRevenue);
  return { ...population(members), activeCount: active.length };
}

/** Customers with a paid order in the lookback before `quietSpan` and none inside it. */
export function dormantCustomerPopulation(
  historyEvents: readonly PaidOrderEvent[],
  quietSpan: DateSpan,
  lookbackStart: string
): CustomerPopulation {
  const before = { start: lookbackStart, end: addDaysYmd(quietSpan.start, -1) };
  const members = groupCustomers(historyEvents)
    .map(group => ({ group, prior: eventsInSpan(group.records, before), quiet: eventsInSpan(group.records, quietSpan) }))
    .filter(({ prior, quiet }) => prior.length > 0 && quiet.length === 0)
    .map(({ group, prior }) => summarize(group, prior))
    .sort((a, b) => (b.lastOrderDate ?? "").localeCompare(a.lastOrderDate ?? "") || byRevenue(a, b));
  return population(members);
}

export function topCustomers(
  historyEvents: readonly PaidOrderEvent[],
  span: DateSpan,
  limit = 5
): CustomerSummary[] {
  return activeCustomerPopulation(historyEvents, span, 1).members.slice(0, Math.max(1, limit));
}

function nameTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9' -]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Customers whose recorded name contains every word of `name` (word-prefix match). */
export function findCustomersByName(
  historyEvents: readonly PaidOrderEvent[],
  span: DateSpan,
  name: string
): CustomerSummary[] {
  const wanted = nameTokens(name);
  if (!wanted.length) return [];
  return groupCustomers(historyEvents)
    .filter(group =>
      group.records.some(record => {
        const words = nameTokens(record.customerName ?? "");
        return wanted.every(token => words.some(word => word.startsWith(token)));
      })
    )
    .map(group => summarize(group, eventsInSpan(group.records, span)))
    .sort(byRevenue);
}
