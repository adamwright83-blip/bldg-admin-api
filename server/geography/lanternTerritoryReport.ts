import { identityKeysFor } from "../analytics/customerIdentityResolution";
import {
  activeCustomerPopulation,
  compareTotals,
  dormantCustomerPopulation,
  eventsInSpan,
  summarizeTotals,
} from "../analytics/businessMetrics";
import { CUSTOMER_LOOKBACK_DAYS } from "../analytics/businessQuery";
import { addDaysYmd, previousPeriod, resolvePeriod } from "../analytics/businessPeriods";
import type { PaidOrderEvent } from "../analytics/paidOrderLedger";
import {
  attributeLanternPoint,
  streetIdentity,
  territoriesInServiceAreas,
  type ServiceArea,
} from "../../shared/lanternTerritoryAttribution";
import { LANTERN_TERRITORIES, type LanternTerritory } from "../../shared/lanternTerritories";
import type {
  LanternReportWindowDays,
  LanternTerritoryMetric,
  LanternTerritoryReport,
} from "../../shared/lanternTerritoryReport";

export type ReportCustomer = {
  identityKey: string;
  displayName: string;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  geocodeStatus: string | null;
  canonicalAddress: string | null;
  identityKeys: string[];
};

export type ReportSourceQuality = {
  bookStatus: LanternTerritoryReport["source"]["bookStatus"];
  completeness: string | null;
  loadedSources: string[];
  failedSources: string[];
  checkedAt: string | null;
  mayStateExact: boolean;
  comparisonMayStateExact: boolean;
  customerCountsReliable: boolean;
  sourcesAllowChange: boolean;
  emptyIsReal: boolean;
  notes: string[];
};

const EMPTY_SOURCE: ReportSourceQuality = {
  bookStatus: "unknown",
  completeness: null,
  loadedSources: [],
  failedSources: [],
  checkedAt: null,
  mayStateExact: false,
  comparisonMayStateExact: false,
  customerCountsReliable: false,
  sourcesAllowChange: false,
  emptyIsReal: false,
  notes: [],
};

type Owner = { id: string; name: string } | "ambiguous" | "unlocated" | "outside";

function dedupe(events: readonly PaidOrderEvent[]): PaidOrderEvent[] {
  const seen = new Set<string>();
  const out: PaidOrderEvent[] = [];
  for (const event of events) {
    if (seen.has(event.eventKey)) continue;
    seen.add(event.eventKey);
    out.push(event);
  }
  return out;
}

function measured(
  events: readonly PaidOrderEvent[],
  source: ReportSourceQuality
): { cents: number | null; orders: number | null; note: string } {
  const totals = summarizeTotals(events);
  if (totals.revenueCents === 0 && totals.orderCount === 0) {
    if (!source.emptyIsReal) {
      return { cents: null, orders: null, note: "No readable paid orders. That is not a measured zero." };
    }
    return { cents: 0, orders: 0, note: "No paid orders in this window." };
  }
  return {
    cents: totals.revenueCents,
    orders: totals.orderCount,
    note: source.mayStateExact
      ? "Recorded paid-order revenue for this window."
      : "Recorded paid orders. Not an exact business total.",
  };
}

/**
 * Partition one reconciled paid-order book across the tenant's supported territories.
 * Each event is counted once. Address text that only resembles a territory name is ignored.
 */
export function buildLanternTerritoryReport(input: {
  tenantId: string;
  windowDays: LanternReportWindowDays;
  now: Date;
  timeZone: string;
  areas: readonly ServiceArea[];
  geographyBasis: LanternTerritoryReport["geographyBasis"];
  customers: readonly ReportCustomer[];
  includedEvents: readonly PaidOrderEvent[];
  missingPaymentEvidence?: { orderCount: number; cents: number };
  source?: Partial<ReportSourceQuality>;
  territories?: readonly LanternTerritory[];
  figuresAreLive?: boolean;
}): LanternTerritoryReport {
  const source: ReportSourceQuality = { ...EMPTY_SOURCE, ...input.source };
  const catalog = input.territories ?? LANTERN_TERRITORIES;
  const supported = territoriesInServiceAreas(input.areas, catalog);
  const supportedIds = new Set(supported.map(territory => territory.id));
  const period = resolvePeriod({ kind: "trailing_days", days: input.windowDays }, input.now, input.timeZone);
  const comparisonPeriod = previousPeriod(period, input.now);
  const lookbackStart = addDaysYmd(period.start, -CUSTOMER_LOOKBACK_DAYS);
  const missing = input.missingPaymentEvidence ?? { orderCount: 0, cents: 0 };
  const sourceView = {
    bookStatus: source.bookStatus,
    completeness: source.completeness,
    loadedSources: source.loadedSources,
    failedSources: source.failedSources,
    checkedAt: source.checkedAt,
    mayStateExact: source.mayStateExact,
    notes: source.notes,
  };

  const empty = (status: LanternTerritoryReport["status"], reason: string): LanternTerritoryReport => ({
    tenantId: input.tenantId,
    figuresAreLive: input.figuresAreLive ?? true,
    windowDays: input.windowDays,
    periodLabel: period.label,
    comparisonLabel: comparisonPeriod.label,
    status,
    reason,
    geographyBasis: input.geographyBasis,
    source: sourceView,
    comparison: {
      mostRecordedRevenue: null,
      steepestDecline: null,
      dormantOpportunities: [],
      insufficient: [{ territoryId: "book", name: "This business", reason }],
      withheldReason: reason,
    },
    territories: [],
    unattributed: { revenueCents: 0, orderCount: 0 },
    ambiguous: { revenueCents: 0, orderCount: 0 },
    outsideService: { revenueCents: 0, orderCount: 0 },
    missingPaymentEvidence: missing,
    partitionedRevenueCents: null,
  });

  if (!input.areas.length || input.geographyBasis === "none") {
    return empty(
      "unsupported_geography",
      "No authoritative service location is configured for this business. Lantern City will not substitute another city's map."
    );
  }
  if (!supported.length) {
    return empty(
      "unsupported_geography",
      "This business's configured service area does not reach a Lantern City territory. Unsupported geography is left blank."
    );
  }

  const ownerByCustomer = new Map<string, Owner>();
  const located = new Map<string, ReportCustomer[]>();
  const keyOwners = new Map<string, Set<string>>();

  for (const customer of input.customers) {
    const geocoded =
      customer.geocodeStatus === "success" && customer.latitude != null && customer.longitude != null;
    if (!geocoded) {
      ownerByCustomer.set(customer.identityKey, "unlocated");
      continue;
    }
    const point = attributeLanternPoint({
      latitude: customer.latitude,
      longitude: customer.longitude,
      premiseStreet: streetIdentity(customer.canonicalAddress),
      territories: catalog,
    });
    if (point.status === "ambiguous") {
      ownerByCustomer.set(customer.identityKey, "ambiguous");
      continue;
    }
    if (point.status !== "assigned") {
      ownerByCustomer.set(customer.identityKey, "unlocated");
      continue;
    }
    if (!supportedIds.has(point.territoryId)) {
      ownerByCustomer.set(customer.identityKey, "outside");
      continue;
    }
    ownerByCustomer.set(customer.identityKey, { id: point.territoryId, name: point.territoryName });
    const list = located.get(point.territoryId) ?? [];
    list.push(customer);
    located.set(point.territoryId, list);
    for (const key of customer.identityKeys) {
      const owners = keyOwners.get(key) ?? new Set<string>();
      owners.add(point.territoryId);
      keyOwners.set(key, owners);
    }
  }

  const classify = (event: PaidOrderEvent): { bucket: "territory"; id: string } | "unattributed" | "ambiguous" | "outside" => {
    const keys = identityKeysFor(event.identity);
    if (!keys.length) return "unattributed";
    let matched = false;
    let ambiguous = false;
    let outside = false;
    const territories = new Set<string>();
    for (const customer of input.customers) {
      if (!customer.identityKeys.some(key => keys.includes(key))) continue;
      matched = true;
      const owner = ownerByCustomer.get(customer.identityKey);
      if (owner === "ambiguous") ambiguous = true;
      else if (owner === "outside") outside = true;
      else if (owner && owner !== "unlocated") territories.add(owner.id);
    }
    for (const key of keys) {
      const owners = keyOwners.get(key);
      if (owners && owners.size > 1) ambiguous = true;
    }
    if (!matched) return "unattributed";
    if (ambiguous || territories.size > 1) return "ambiguous";
    if (territories.size === 1) return { bucket: "territory", id: [...territories][0]! };
    if (outside) return "outside";
    return "unattributed";
  };

  const split = (events: readonly PaidOrderEvent[]) => {
    const byTerritory = new Map<string, PaidOrderEvent[]>();
    const pools = { unattributed: [] as PaidOrderEvent[], ambiguous: [] as PaidOrderEvent[], outside: [] as PaidOrderEvent[] };
    for (const event of dedupe(events)) {
      const decision = classify(event);
      if (decision === "unattributed" || decision === "ambiguous" || decision === "outside") {
        pools[decision === "outside" ? "outside" : decision].push(event);
        continue;
      }
      const list = byTerritory.get(decision.id) ?? [];
      list.push(event);
      byTerritory.set(decision.id, list);
    }
    return { byTerritory, pools };
  };

  const current = split(eventsInSpan(input.includedEvents, period));
  const previous = split(eventsInSpan(input.includedEvents, comparisonPeriod));
  const history = split(
    input.includedEvents.filter(event => event.businessDate >= lookbackStart && event.businessDate <= period.end)
  );
  const unattributed = summarizeTotals(current.pools.unattributed);
  const ambiguous = summarizeTotals(current.pools.ambiguous);
  const outsideService = summarizeTotals(current.pools.outside);
  const cleanPartition =
    unattributed.revenueCents === 0 &&
    unattributed.orderCount === 0 &&
    ambiguous.revenueCents === 0 &&
    ambiguous.orderCount === 0 &&
    outsideService.revenueCents === 0 &&
    outsideService.orderCount === 0 &&
    missing.orderCount === 0 &&
    missing.cents === 0;
  const changeReliable = source.sourcesAllowChange && cleanPartition;

  const territories: LanternTerritoryMetric[] = supported
    .map(territory => {
      const recorded = measured(current.byTerritory.get(territory.id) ?? [], source);
      const prior = measured(previous.byTerritory.get(territory.id) ?? [], source);
      const comparison =
        recorded.cents != null && prior.cents != null
          ? compareTotals(
              { revenueCents: recorded.cents, orderCount: recorded.orders ?? 0, aovCents: null },
              { revenueCents: prior.cents, orderCount: prior.orders ?? 0, aovCents: null }
            )
          : null;
      const historyEvents = history.byTerritory.get(territory.id) ?? [];
      const activeCustomers = source.customerCountsReliable
        ? activeCustomerPopulation(historyEvents, period).count
        : null;
      const dormantCustomers = source.customerCountsReliable
        ? dormantCustomerPopulation(historyEvents, period, lookbackStart).count
        : null;
      const reliableDirection = changeReliable && comparison != null;
      const change = comparison?.revenueChangeCents ?? null;
      return {
        id: territory.id,
        name: territory.name,
        revenueCents: recorded.cents,
        previousRevenueCents: prior.cents,
        revenueChangeCents: change,
        paidOrderCount: recorded.orders,
        activeCustomers,
        dormantCustomers,
        locatedCustomers: (located.get(territory.id) ?? []).length,
        direction: !reliableDirection || change == null ? "unknown" : change > 0 ? "up" : change < 0 ? "down" : "flat",
        directionReliable: reliableDirection,
        evidenceNote: recorded.note,
        customers: (located.get(territory.id) ?? [])
          .slice()
          .sort((a, b) => a.displayName.localeCompare(b.displayName))
          .slice(0, 12)
          .map(customer => ({
            identityKey: customer.identityKey,
            displayName: customer.displayName,
            phone: customer.phone,
          })),
      } satisfies LanternTerritoryMetric;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const insufficient: LanternTerritoryReport["comparison"]["insufficient"] = [];
  if (unattributed.orderCount) {
    insufficient.push({
      territoryId: "unattributed",
      name: "Unattributed orders",
      reason: "Paid orders with no authoritative location stay unassigned. They are not spread across neighborhoods.",
    });
  }
  if (ambiguous.orderCount) {
    insufficient.push({
      territoryId: "ambiguous",
      name: "Ambiguous geography",
      reason: "Overlapping boundaries or identities. Those orders are withheld so they are not counted twice.",
    });
  }
  if (outsideService.orderCount) {
    insufficient.push({
      territoryId: "outside",
      name: "Outside the configured service area",
      reason: "These customers sit outside the territories this business is configured to serve.",
    });
  }
  if (missing.orderCount) {
    insufficient.push({
      territoryId: "payment",
      name: "Missing payment evidence",
      reason: "Some paid flags have no payment evidence. They are not revenue, and they block a ranking.",
    });
  }
  if (!changeReliable) {
    insufficient.push({
      territoryId: "change",
      name: "Period comparison",
      reason: source.sourcesAllowChange
        ? "Unattributed, ambiguous, or unproven orders mean the periods cannot be compared."
        : "Source coverage is not fresh and complete for both windows, so change is not highlighted.",
    });
  }
  if (!source.customerCountsReliable) {
    insufficient.push({
      territoryId: "dormant",
      name: "Dormant customers",
      reason: "Customer counts are not reliable enough to call a recovery opportunity.",
    });
  }

  const measurable = territories.every(territory => territory.revenueCents != null);
  let most: LanternTerritoryReport["comparison"]["mostRecordedRevenue"] = null;
  if (measurable && cleanPartition && source.bookStatus !== "unavailable" && territories.length) {
    const sorted = [...territories].sort(
      (a, b) => (b.revenueCents ?? 0) - (a.revenueCents ?? 0) || a.name.localeCompare(b.name)
    );
    const leader = sorted[0]!;
    const tied = sorted.filter(territory => territory.revenueCents === leader.revenueCents);
    if (tied.length === 1) {
      most = {
        territoryId: leader.id,
        name: leader.name,
        revenueCents: leader.revenueCents!,
        evidenceClass: source.bookStatus,
      };
    } else {
      insufficient.push({
        territoryId: "tie",
        name: "Recorded revenue",
        reason: `${tied.map(territory => territory.name).join(" and ")} recorded the same revenue. There is no single leader.`,
      });
    }
  } else {
    insufficient.push({
      territoryId: "rank",
      name: "Recorded revenue",
      reason: "Territories are not ranked when a window, the coverage, or a territory's evidence does not match.",
    });
  }

  let steepest: LanternTerritoryReport["comparison"]["steepestDecline"] = null;
  if (changeReliable && measurable) {
    const declines = territories.filter(territory => (territory.revenueChangeCents ?? 0) < 0);
    const sorted = [...declines].sort(
      (a, b) => a.revenueChangeCents! - b.revenueChangeCents! || a.name.localeCompare(b.name)
    );
    const leader = sorted[0];
    const tied = leader ? sorted.filter(territory => territory.revenueChangeCents === leader.revenueChangeCents) : [];
    if (leader && tied.length === 1) {
      steepest = {
        territoryId: leader.id,
        name: leader.name,
        revenueChangeCents: leader.revenueChangeCents!,
      };
    }
  }

  const partitioned = summarizeTotals([
    ...[...current.byTerritory.values()].flat(),
    ...current.pools.unattributed,
    ...current.pools.ambiguous,
    ...current.pools.outside,
  ]);
  const canonical = summarizeTotals(dedupe(eventsInSpan(input.includedEvents, period)));

  return {
    tenantId: input.tenantId,
    figuresAreLive: input.figuresAreLive ?? true,
    windowDays: input.windowDays,
    periodLabel: period.label,
    comparisonLabel: comparisonPeriod.label,
    status: "ready",
    reason: null,
    geographyBasis: input.geographyBasis,
    source: sourceView,
    comparison: {
      mostRecordedRevenue: most,
      steepestDecline: steepest,
      dormantOpportunities: source.customerCountsReliable
        ? territories
            .filter(territory => (territory.dormantCustomers ?? 0) > 0)
            .map(territory => ({
              territoryId: territory.id,
              name: territory.name,
              dormantCustomers: territory.dormantCustomers!,
            }))
        : [],
      insufficient,
      withheldReason: cleanPartition ? null : "Ranking is withheld until every paid order has one authoritative territory.",
    },
    territories,
    unattributed: { revenueCents: unattributed.revenueCents, orderCount: unattributed.orderCount },
    ambiguous: { revenueCents: ambiguous.revenueCents, orderCount: ambiguous.orderCount },
    outsideService: { revenueCents: outsideService.revenueCents, orderCount: outsideService.orderCount },
    missingPaymentEvidence: missing,
    partitionedRevenueCents: partitioned.revenueCents === canonical.revenueCents ? partitioned.revenueCents : null,
  };
}
