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
import {
  loadBusinessSourceCoverage,
  SOURCE_COVERAGE_CONTRACT_VERSION,
  type BusinessSourceCoverageSnapshot,
} from "./sourceCoverage";

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
 * Coverage comes only from B1 `loadBusinessSourceCoverage` (contract version 1).
 * This module does not decide fresh, stale, partial, or unavailable.
 * `book.exactRevenueLicensed` and `book.allCustomersLicensed` stay false.
 * Exact whole-business payment revenue requires `book.exhaustiveCurrent`,
 * `book.paymentEventsProven`, a window inside the proven CleanCloud span when
 * that source is held, and completed reconciliation. Stale is not zero.
 */

export type ReadBusinessSourceCoverage = (input: {
  tenantId: string;
  from: string;
  to: string;
  now?: Date;
}) => Promise<BusinessSourceCoverageSnapshot | null>;

/** Loads B1's snapshot. Returns null when the contract cannot be read. Does not invent a status. */
export async function loadRevenueSourceCoverage(input: {
  tenantId: string;
  now?: Date;
}): Promise<BusinessSourceCoverageSnapshot | null> {
  try {
    const snapshot = await loadBusinessSourceCoverage({
      tenantId: input.tenantId,
      now: input.now,
    });
    if (snapshot.contractVersion !== SOURCE_COVERAGE_CONTRACT_VERSION) return null;
    return snapshot;
  } catch (error) {
    console.warn(
      "[Revenue] source coverage contract unavailable",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

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

export type CanonicalRevenuePrecision = "exact" | "recorded_only";

export type CanonicalRevenueCoverage = {
  contractVersion: typeof SOURCE_COVERAGE_CONTRACT_VERSION | null;
  /** False when B1's snapshot could not be read. That is not a fresh book. */
  snapshotRead: boolean;
  incompleteForWindow: boolean;
  /** True only when B1's CleanCloud source status is `fresh`. */
  cleanCloudFresh: boolean;
  cleanCloudStatus: BusinessSourceCoverageSnapshot["sources"][number]["status"] | "not_held" | null;
  bookStatus: BusinessSourceCoverageSnapshot["book"]["status"] | null;
  exhaustiveCurrent: boolean;
  paymentEventsProven: boolean;
  /** Copied from B1. This read never sets it true. */
  exactRevenueLicensed: false;
  allCustomersLicensed: false;
  staleIsZero: false;
  /** Coverage itself allows an exact whole-business payment total. Reconciliation is separate. */
  coverageAllowsExact: boolean;
  affectedSources: string[];
  loadedSources: LedgerSource[];
  failedSources: LedgerSource[];
  provenance: string | null;
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
  /** Recorded included cents. Stale coverage does not change this to zero. */
  recordedCents: number;
  /** Present only when coverage and reconciliation both allow an exact total. */
  statedExactCents: number | null;
  mayStateExact: boolean;
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

function windowInsideProvenSpan(
  window: { from: string; to: string },
  snapshot: BusinessSourceCoverageSnapshot
): boolean {
  const cleancloud = snapshot.sources.find(source => source.sourceId === "cleancloud");
  if (!cleancloud?.includedInCombinedBook) return true;
  const span = snapshot.book.scope.cleancloudOrdersCreated;
  if (!span) return false;
  return window.from >= span.from && window.to <= span.through;
}

/**
 * Reads B1's snapshot. Does not compute freshness.
 * Exact payment revenue needs exhaustive current coverage, proven payment
 * events, and the requested window inside the proven span.
 */
export function interpretSourceCoverage(input: {
  snapshot: BusinessSourceCoverageSnapshot | null | undefined;
  window: { from: string; to: string };
  loadedSources: readonly LedgerSource[];
  failedSources: readonly LedgerSource[];
}): CanonicalRevenueCoverage {
  const failed = [...input.failedSources];
  const base = {
    loadedSources: [...input.loadedSources],
    failedSources: failed,
    exactRevenueLicensed: false as const,
    allCustomersLicensed: false as const,
    staleIsZero: false as const,
  };
  if (input.snapshot == null || input.snapshot.contractVersion !== SOURCE_COVERAGE_CONTRACT_VERSION) {
    return {
      ...base,
      contractVersion: null,
      snapshotRead: false,
      incompleteForWindow: true,
      cleanCloudFresh: false,
      cleanCloudStatus: null,
      bookStatus: null,
      exhaustiveCurrent: false,
      paymentEventsProven: false,
      coverageAllowsExact: false,
      affectedSources: failed,
      provenance: null,
    };
  }

  const snapshot = input.snapshot;
  const cleancloud = snapshot.sources.find(source => source.sourceId === "cleancloud");
  const cleanCloudStatus = !cleancloud
    ? null
    : cleancloud.includedInCombinedBook
      ? cleancloud.status
      : "not_held";
  const cleanCloudFresh = Boolean(cleancloud?.status === "fresh" && cleancloud.includedInCombinedBook);
  const heldNotFresh = snapshot.sources.filter(
    source => source.includedInCombinedBook && source.status !== "fresh"
  );
  const spanCovers = windowInsideProvenSpan(input.window, snapshot);
  const flagsTrusted =
    snapshot.book.exactRevenueLicensed === false &&
    snapshot.book.allCustomersLicensed === false &&
    snapshot.book.staleIsZero === false &&
    snapshot.book.missingIsNoCustomers === false;
  const coverageAllowsExact =
    flagsTrusted &&
    snapshot.book.exhaustiveCurrent &&
    snapshot.book.paymentEventsProven &&
    heldNotFresh.length === 0 &&
    spanCovers &&
    failed.length === 0;
  const incompleteForWindow =
    !snapshot.book.exhaustiveCurrent || heldNotFresh.length > 0 || !spanCovers || failed.length > 0;

  return {
    ...base,
    contractVersion: snapshot.contractVersion,
    snapshotRead: true,
    incompleteForWindow,
    cleanCloudFresh,
    cleanCloudStatus,
    bookStatus: snapshot.book.status,
    exhaustiveCurrent: snapshot.book.exhaustiveCurrent,
    paymentEventsProven: snapshot.book.paymentEventsProven,
    coverageAllowsExact,
    affectedSources: Array.from(
      new Set([
        ...heldNotFresh.map(source => source.sourceId),
        ...snapshot.blockingSources.map(source => source.sourceId),
        ...failed,
      ])
    ),
    provenance: snapshot.sources.find(source => source.includedInCombinedBook)?.provenance.decidedBy ?? null,
  };
}

export function revenueMayStateExact(input: {
  coverage: CanonicalRevenueCoverage;
  reconciled: ReconciledRevenue;
}): boolean {
  return input.coverage.coverageAllowsExact && input.reconciled.suspectedWithheld.count === 0;
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
  now?: Date;
  /** Pass a snapshot to avoid a second load. Omit to call `loadBusinessSourceCoverage`. Null means the contract could not be read. */
  coverage?: BusinessSourceCoverageSnapshot | null;
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
  const snapshot =
    input.coverage === undefined
      ? await loadRevenueSourceCoverage({ tenantId: input.tenantId, now: input.now })
      : input.coverage;
  const coverage = interpretSourceCoverage({
    snapshot,
    window: { from, to },
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
  const mayStateExact = revenueMayStateExact({ coverage, reconciled });
  return {
    status: "ok",
    tenantId: input.tenantId,
    window: { from, to },
    ...reconciled,
    recordedCents: reconciled.exactIncludedCents,
    statedExactCents: mayStateExact ? reconciled.exactIncludedCents : null,
    mayStateExact,
    coverage,
    precision: mayStateExact ? "exact" : "recorded_only",
  };
}
