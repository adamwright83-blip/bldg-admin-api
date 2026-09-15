import { addDaysYmd } from "./businessPeriods";
import { resolveCustomerIdentities } from "./customerIdentityResolution";
import type { BuildingKey, BusinessLine, LedgerSource, PaymentProcessor } from "./businessLineage";
import type { PaidOrderEvent, ServiceType } from "./paidOrderLedger";

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

type CustomerGroup = { identityId: string; matched: boolean; keys: string[]; records: PaidOrderEvent[] };

export function groupCustomers(events: readonly PaidOrderEvent[]): CustomerGroup[] {
  return resolveCustomerIdentities(events, event => event.identity).groups.map(group => ({
    identityId: group.id,
    matched: group.matched,
    keys: group.keys,
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

/**
 * Customers with a paid order in the lookback before `quietSpan` and none inside it.
 * `minPriorOrders` narrows to customers who previously ordered at least that often.
 */
export function dormantCustomerPopulation(
  historyEvents: readonly PaidOrderEvent[],
  quietSpan: DateSpan,
  lookbackStart: string,
  minPriorOrders = 1
): CustomerPopulation {
  const before = { start: lookbackStart, end: addDaysYmd(quietSpan.start, -1) };
  const members = groupCustomers(historyEvents)
    .map(group => ({ group, prior: eventsInSpan(group.records, before), quiet: eventsInSpan(group.records, quietSpan) }))
    .filter(({ prior, quiet }) => prior.length >= Math.max(1, minPriorOrders) && quiet.length === 0)
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
    .replace(/'s\b/g, "")
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

// ── Customer detail (Customer 360 over paid orders) ─────────────────────────

export type OrderBrief = {
  eventKey: string;
  orderNumber: string | null;
  date: string;
  occurredAt: string;
  cents: number;
  source: LedgerSource;
  businessLine: BusinessLine | null;
  processor: PaymentProcessor | null;
  building: BuildingKey | null;
  serviceType: ServiceType | null;
  summary: string | null;
  customerName: string | null;
  address: string | null;
  ingestedAt: string | null;
};

export function orderBrief(event: PaidOrderEvent): OrderBrief {
  return {
    eventKey: event.eventKey,
    orderNumber: event.orderNumber ?? null,
    date: event.businessDate,
    occurredAt: event.occurredAt.toISOString(),
    cents: event.cents,
    source: event.source,
    businessLine: event.businessLine ?? null,
    processor: event.processor ?? null,
    building: event.building ?? null,
    serviceType: event.serviceType,
    summary: event.summary ?? null,
    customerName: event.customerName,
    address: event.address ?? null,
    ingestedAt: event.ingestedAt ? event.ingestedAt.toISOString() : null,
  };
}

export type CustomerDetail = CustomerSummary & {
  identityKeys: string[];
  nameVariants: string[];
  largestOrder: OrderBrief | null;
  lastOrder: OrderBrief | null;
  firstOrder: OrderBrief | null;
  /** Median days between consecutive paid orders; null with fewer than two orders. */
  medianGapDays: number | null;
  averageGapDays: number | null;
  daysSinceLastOrder: number | null;
  serviceMix: { wash_fold: number; dry_cleaning: number; unclassified: number };
  businessLines: BusinessLine[];
  buildings: BuildingKey[];
  addresses: string[];
  /** Newest first, capped. */
  recentOrders: OrderBrief[];
};

function dayNumber(ymd: string): number {
  return Math.round(Date.parse(`${ymd}T00:00:00Z`) / 864e5);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round(((sorted[mid - 1]! + sorted[mid]!) / 2) * 10) / 10;
}

export function customerDetailFor(
  group: CustomerGroup,
  span: DateSpan,
  today: string,
  recentLimit = 12
): CustomerDetail {
  const inSpan = eventsInSpan(group.records, span).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const base = summarize(group, inSpan);
  const days = Array.from(new Set(inSpan.map(event => event.businessDate))).map(dayNumber).sort((a, b) => a - b);
  const gaps = days.slice(1).map((day, index) => day - days[index]!);
  const largest = inSpan.reduce<PaidOrderEvent | null>((best, event) => (!best || event.cents > best.cents ? event : best), null);
  const allSorted = [...group.records].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const lastEver = allSorted[allSorted.length - 1];
  return {
    ...base,
    identityKeys: group.keys,
    nameVariants: Array.from(new Set(group.records.map(record => record.customerName).filter((name): name is string => Boolean(name)))),
    largestOrder: largest ? orderBrief(largest) : null,
    lastOrder: inSpan.length ? orderBrief(inSpan[inSpan.length - 1]!) : null,
    firstOrder: inSpan.length ? orderBrief(inSpan[0]!) : null,
    medianGapDays: median(gaps),
    averageGapDays: gaps.length ? Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10 : null,
    daysSinceLastOrder: lastEver ? dayNumber(today) - dayNumber(lastEver.businessDate) : null,
    serviceMix: {
      wash_fold: inSpan.filter(event => event.serviceType === "wash_fold").length,
      dry_cleaning: inSpan.filter(event => event.serviceType === "dry_cleaning").length,
      unclassified: inSpan.filter(event => !event.serviceType).length,
    },
    businessLines: Array.from(new Set(inSpan.map(event => event.businessLine).filter((line): line is BusinessLine => Boolean(line)))),
    buildings: Array.from(new Set(group.records.map(event => event.building).filter((key): key is BuildingKey => Boolean(key)))),
    addresses: Array.from(new Set(group.records.map(event => event.address).filter((value): value is string => Boolean(value)))).slice(0, 3),
    recentOrders: [...inSpan].reverse().slice(0, recentLimit).map(orderBrief),
  };
}

/** Name match that also accepts possessives ("John's") and prefix tokens. */
export function customerGroupsMatchingName(events: readonly PaidOrderEvent[], name: string): CustomerGroup[] {
  const wanted = nameTokens(name);
  if (!wanted.length) return [];
  const groups = groupCustomers(events).filter(group =>
    group.records.some(record => {
      const words = nameTokens(record.customerName ?? "");
      return wanted.every(token => words.some(word => word.startsWith(token)));
    })
  );
  // An exact full-name match beats looser prefix matches ("Carol" vs "Caroline").
  const exact = groups.filter(group =>
    group.records.some(record => {
      const words = nameTokens(record.customerName ?? "");
      return wanted.every(token => words.includes(token));
    })
  );
  return exact.length ? exact : groups;
}

export function customerGroupsForKeys(events: readonly PaidOrderEvent[], keys: readonly string[]): CustomerGroup[] {
  if (!keys.length) return [];
  return groupCustomers(events).filter(group => group.keys.some(key => keys.includes(key)));
}

/** All events belonging to the resolved identity of any of `keys`. */
export function eventsForCustomerKeys(events: readonly PaidOrderEvent[], keys: readonly string[]): PaidOrderEvent[] {
  return customerGroupsForKeys(events, keys).flatMap(group => group.records);
}

// ── Grouping and ranking ─────────────────────────────────────────────────────

export type GroupDimension = "month" | "week" | "day" | "business_line" | "source" | "processor" | "building" | "service";

export type GroupRow = { key: string; revenueCents: number; orderCount: number; aovCents: number | null };

export function groupEvents(events: readonly PaidOrderEvent[], dimension: GroupDimension): GroupRow[] {
  const keyOf = (event: PaidOrderEvent): string => {
    switch (dimension) {
      case "month":
        return event.businessDate.slice(0, 7);
      case "week":
        return weekStart(event.businessDate);
      case "day":
        return event.businessDate;
      case "business_line":
        return event.businessLine ?? "unattributed";
      case "source":
        return event.source;
      case "processor":
        return event.processor ?? "other_or_unknown";
      case "building":
        return event.building ?? "no_building";
      case "service":
        return event.serviceType ?? "unclassified";
    }
  };
  const map = new Map<string, GroupRow>();
  for (const event of events) {
    const key = keyOf(event);
    const row = map.get(key) ?? { key, revenueCents: 0, orderCount: 0, aovCents: null };
    row.revenueCents += event.cents;
    row.orderCount += 1;
    map.set(key, row);
  }
  return Array.from(map.values())
    .map(row => ({ ...row, aovCents: row.orderCount ? Math.round(row.revenueCents / row.orderCount) : null }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function largestOrders(events: readonly PaidOrderEvent[], limit = 5): OrderBrief[] {
  return [...events]
    .sort((a, b) => b.cents - a.cents || b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, Math.max(1, limit))
    .map(orderBrief);
}

export function latestOrders(events: readonly PaidOrderEvent[], limit = 5): OrderBrief[] {
  return [...events]
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.eventKey.localeCompare(a.eventKey))
    .slice(0, Math.max(1, limit))
    .map(orderBrief);
}

export type CustomerMover = {
  identityId: string;
  displayName: string;
  currentCents: number;
  previousCents: number;
  deltaCents: number;
};

/** Which customer identities moved revenue most between two spans. */
export function customerRevenueMovers(
  events: readonly PaidOrderEvent[],
  current: DateSpan,
  previous: DateSpan,
  limit = 3
): CustomerMover[] {
  return groupCustomers(events)
    .map(group => {
      const currentCents = eventsInSpan(group.records, current).reduce((sum, event) => sum + event.cents, 0);
      const previousCents = eventsInSpan(group.records, previous).reduce((sum, event) => sum + event.cents, 0);
      return {
        identityId: group.identityId,
        displayName: summarize(group, group.records).displayName,
        currentCents,
        previousCents,
        deltaCents: currentCents - previousCents,
      };
    })
    .filter(mover => mover.deltaCents !== 0)
    .sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents) || a.displayName.localeCompare(b.displayName))
    .slice(0, Math.max(1, limit));
}

export function earliestOrders(events: readonly PaidOrderEvent[], limit = 5): OrderBrief[] {
  return [...events]
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.eventKey.localeCompare(b.eventKey))
    .slice(0, Math.max(1, limit))
    .map(orderBrief);
}

/** Customers ranked by paid order count (then revenue) inside `span`. */
export function mostFrequentCustomers(events: readonly PaidOrderEvent[], span: DateSpan, limit = 5): CustomerSummary[] {
  return activeCustomerPopulation(events, span, 1)
    .members.sort((a, b) => b.orderCount - a.orderCount || b.revenueCents - a.revenueCents)
    .slice(0, Math.max(1, limit));
}
