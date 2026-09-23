import { getDashboardTimeZone, zonedDayStartUtc } from "../dashboardZoned";
import { addDaysYmd } from "./businessPeriods";
import {
  findSuspectedCrossSourcePairs,
  loadPaidOrderLedger,
  type LedgerLoaders,
  type LedgerSource,
  type PaidOrderEvent,
  type PaidOrderLedger,
  type ProvenDuplicateExclusion,
  type UnverifiedPaidOrder,
} from "./paidOrderLedger";

/**
 * Canonical revenue read for JOYSTICK.
 *
 * One function states paid revenue across native Stripe orders and CleanCloud.
 * `getRevenueSummary`, Claire's revenue / AOV / revenue-driver / profit totals,
 * and strategy `netSales` all derive the stated cents from `reconcilePaidRevenue`.
 * `summarizeTotals` only adds the events it is given; it is not a second
 * revenue authority.
 *
 * These are not this read, and must not be spoken as the same number:
 * - True P&L gross revenue (operator spreadsheet rows)
 * - Clearent settlement totals (processor evidence for CleanCloud card orders
 *   already in this book)
 * - Tower Wars visualization sums
 *
 * Coverage seam: Project B1 owns source freshness. This module does not decide
 * whether CleanCloud is fresh. Pass `coverage` from B1's contract, or leave it
 * null. Null means the contract is not supplied: the read will not call
 * CleanCloud fresh and will not call the total definitive.
 */

export type BusinessSourceCoverageSource = {
  /** Stable source id. `cleancloud` and `laundry_butler` are recognized. */
  source: string;
  /**
   * B1's status string, read opaquely. Effects this read implements:
   * `fresh` may support a definitive total when reconciliation is complete;
   * `stale`, `partial`, and `unavailable` mark the window incomplete and
   * keep known cents; any other string is not fresh.
   */
  coverageStatus: string;
  lastSuccessfulAssimilation: string | null;
  provenance: string;
};

/** The only coverage input B2 accepts. B1 fills it. */
export type BusinessSourceCoverageSeam = {
  sources: readonly BusinessSourceCoverageSource[];
};

export type ReadBusinessSourceCoverage = (input: {
  tenantId: string;
  from: string;
  to: string;
}) => Promise<BusinessSourceCoverageSeam | null>;

export type ExplicitEconomicLink = {
  keptEventKey: string;
  excludedEventKey: string;
};

export type DuplicateExclusionItem = {
  keptEventKey: string;
  excludedEventKey: string;
  cents: number;
  reason: ProvenDuplicateExclusion["reason"] | "explicit_economic_link";
};

export type SuspectedWithheldItem = {
  keptEventKey: string;
  withheldEventKey: string;
  cents: number;
  reason: "same_customer_day_and_amount";
};

export type CanonicalRevenuePrecision = "definitive" | "exact_for_included_records";

export type CanonicalRevenueCoverage = {
  contract: "supplied" | "uncontracted";
  /** True when a supplied source is not fresh, or a source failed to load. */
  incompleteForWindow: boolean;
  /** True only when the seam explicitly says CleanCloud is fresh and it loaded. */
  cleanCloudFresh: boolean;
  sources: readonly BusinessSourceCoverageSource[];
  affectedSources: string[];
  loadedSources: LedgerSource[];
  failedSources: LedgerSource[];
};

export type ReconciledRevenue = {
  /** Cents that may be stated as exact for the records included. Suspected copies are absent. */
  exactIncludedCents: number;
  exactIncludedOrderCount: number;
  includedEvents: PaidOrderEvent[];
  definiteDuplicateExclusions: {
    count: number;
    cents: number;
    items: DuplicateExclusionItem[];
  };
  suspectedWithheld: {
    count: number;
    cents: number;
    items: SuspectedWithheldItem[];
  };
  unverifiedNative: { count: number; cents: number };
  provenance: {
    includedEventKeys: string[];
    sources: LedgerSource[];
  };
};

export type CanonicalRevenueOk = ReconciledRevenue & {
  status: "ok";
  tenantId: string;
  window: { from: string; to: string };
  coverage: CanonicalRevenueCoverage;
  precision: CanonicalRevenuePrecision;
};

export type CanonicalRevenueUnavailable = {
  status: "unavailable";
  tenantId: string;
  window: { from: string; to: string };
  reason: "sources_unavailable";
  /** Known records could not be read. This is not an exact total of zero. */
  exactIncludedCents: null;
  coverage: CanonicalRevenueCoverage;
};

export type CanonicalRevenueResult = CanonicalRevenueOk | CanonicalRevenueUnavailable;

export function reconcilePaidRevenue(input: {
  events: readonly PaidOrderEvent[];
  provenExclusions?: readonly ProvenDuplicateExclusion[];
  explicitEconomicLinks?: readonly ExplicitEconomicLink[];
  unverifiedNative?: readonly UnverifiedPaidOrder[];
}): ReconciledRevenue {
  const events = [...input.events].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.eventKey.localeCompare(b.eventKey)
  );
  const present = new Set(events.map(event => event.eventKey));
  const definiteItems: DuplicateExclusionItem[] = [];

  for (const exclusion of input.provenExclusions ?? []) {
    if (!present.has(exclusion.keptEventKey)) continue;
    definiteItems.push(exclusion);
  }

  const excludedByLink = new Set<string>();
  for (const link of input.explicitEconomicLinks ?? []) {
    if (!present.has(link.keptEventKey) || !present.has(link.excludedEventKey)) continue;
    if (link.keptEventKey === link.excludedEventKey) continue;
    const excluded = events.find(event => event.eventKey === link.excludedEventKey);
    if (!excluded || excludedByLink.has(excluded.eventKey)) continue;
    excludedByLink.add(excluded.eventKey);
    definiteItems.push({
      keptEventKey: link.keptEventKey,
      excludedEventKey: link.excludedEventKey,
      cents: excluded.cents,
      reason: "explicit_economic_link",
    });
  }

  const afterProven = events.filter(event => !excludedByLink.has(event.eventKey));
  const suspectedItems: SuspectedWithheldItem[] = findSuspectedCrossSourcePairs(afterProven).map(pair => ({
    keptEventKey: pair.native.eventKey,
    withheldEventKey: pair.cleancloud.eventKey,
    cents: pair.cleancloud.cents,
    reason: "same_customer_day_and_amount",
  }));
  const withheld = new Set(suspectedItems.map(item => item.withheldEventKey));
  const includedEvents = afterProven.filter(event => !withheld.has(event.eventKey));
  const exactIncludedCents = includedEvents.reduce((sum, event) => sum + event.cents, 0);
  const unverified = input.unverifiedNative ?? [];
  const sources = Array.from(new Set(includedEvents.map(event => event.source))).sort();

  return {
    exactIncludedCents,
    exactIncludedOrderCount: includedEvents.length,
    includedEvents,
    definiteDuplicateExclusions: {
      count: definiteItems.length,
      cents: definiteItems.reduce((sum, item) => sum + item.cents, 0),
      items: definiteItems,
    },
    suspectedWithheld: {
      count: suspectedItems.length,
      cents: suspectedItems.reduce((sum, item) => sum + item.cents, 0),
      items: suspectedItems,
    },
    unverifiedNative: {
      count: unverified.length,
      cents: unverified.reduce((sum, order) => sum + order.cents, 0),
    },
    provenance: {
      includedEventKeys: includedEvents.map(event => event.eventKey),
      sources,
    },
  };
}

export function interpretSourceCoverage(input: {
  coverage: BusinessSourceCoverageSeam | null | undefined;
  loadedSources: readonly LedgerSource[];
  failedSources: readonly LedgerSource[];
}): CanonicalRevenueCoverage {
  const failed = [...input.failedSources];
  if (input.coverage == null) {
    return {
      contract: "uncontracted",
      incompleteForWindow: failed.length > 0,
      cleanCloudFresh: false,
      sources: [],
      affectedSources: failed,
      loadedSources: [...input.loadedSources],
      failedSources: failed,
    };
  }

  const affectedFromSeam = input.coverage.sources
    .filter(source => source.coverageStatus !== "fresh")
    .map(source => source.source);
  const affected = Array.from(new Set([...affectedFromSeam, ...failed]));
  const cleanCloud = input.coverage.sources.find(source => source.source === "cleancloud");
  const cleanCloudFresh = cleanCloud?.coverageStatus === "fresh" && !failed.includes("cleancloud");

  return {
    contract: "supplied",
    incompleteForWindow: affected.length > 0,
    cleanCloudFresh,
    sources: input.coverage.sources,
    affectedSources: affected,
    loadedSources: [...input.loadedSources],
    failedSources: failed,
  };
}

export function revenuePrecision(input: {
  coverage: CanonicalRevenueCoverage;
  reconciled: ReconciledRevenue;
}): CanonicalRevenuePrecision {
  if (input.coverage.contract !== "supplied" || input.coverage.incompleteForWindow) {
    return "exact_for_included_records";
  }
  if (input.reconciled.suspectedWithheld.count > 0 || input.reconciled.unverifiedNative.count > 0) {
    return "exact_for_included_records";
  }
  if (input.coverage.failedSources.length > 0) return "exact_for_included_records";
  for (const source of input.coverage.loadedSources) {
    const entry = input.coverage.sources.find(item => item.source === source);
    if (!entry || entry.coverageStatus !== "fresh") return "exact_for_included_records";
  }
  return "definitive";
}

export function reconcileLedgerSpan(
  ledger: Pick<PaidOrderLedger, "events" | "provenDuplicateExclusions" | "unverifiedNative">,
  span: { start: string; end: string },
  explicitEconomicLinks?: readonly ExplicitEconomicLink[]
): ReconciledRevenue {
  const events = ledger.events.filter(event => event.businessDate >= span.start && event.businessDate <= span.end);
  const keys = new Set(events.map(event => event.eventKey));
  return reconcilePaidRevenue({
    events,
    provenExclusions: ledger.provenDuplicateExclusions.filter(item => keys.has(item.keptEventKey)),
    explicitEconomicLinks,
    unverifiedNative: ledger.unverifiedNative.filter(
      order => order.businessDate >= span.start && order.businessDate <= span.end
    ),
  });
}

export async function readCanonicalRevenue(input: {
  tenantId: string;
  from: string;
  to: string;
  timeZone?: string;
  coverage?: BusinessSourceCoverageSeam | null;
  loaders?: LedgerLoaders;
  explicitEconomicLinks?: readonly ExplicitEconomicLink[];
}): Promise<CanonicalRevenueResult> {
  const timeZone = input.timeZone ?? getDashboardTimeZone();
  const from = input.from <= input.to ? input.from : input.to;
  const to = input.from <= input.to ? input.to : input.from;
  const ledger = await loadPaidOrderLedger(
    {
      tenantId: input.tenantId,
      startUtc: zonedDayStartUtc(from, timeZone),
      endExclusiveUtc: zonedDayStartUtc(addDaysYmd(to, 1), timeZone),
      timeZone,
    },
    input.loaders
  );
  const coverage = interpretSourceCoverage({
    coverage: input.coverage,
    loadedSources: ledger.loadedSources,
    failedSources: ledger.failedSources,
  });
  if (ledger.completeness === "unavailable") {
    return {
      status: "unavailable",
      tenantId: input.tenantId,
      window: { from, to },
      reason: "sources_unavailable",
      exactIncludedCents: null,
      coverage,
    };
  }
  const reconciled = reconcileLedgerSpan(ledger, { start: from, end: to }, input.explicitEconomicLinks);
  return {
    status: "ok",
    tenantId: input.tenantId,
    window: { from, to },
    ...reconciled,
    coverage,
    precision: revenuePrecision({ coverage, reconciled }),
  };
}
