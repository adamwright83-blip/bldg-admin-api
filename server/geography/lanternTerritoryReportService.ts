import { eq } from "drizzle-orm";
import {
  entityLocations,
  legacyDayforgeSaasTenantLocations,
  territoryOperatorProfiles,
} from "../../drizzle/schema";
import { getDashboardTimeZone, zonedDayStartUtc, zonedYmd } from "../dashboardZoned";
import { getDb } from "../db";
import {
  CUSTOMER_LOOKBACK_DAYS,
  defaultBusinessQuery,
  defaultBusinessQueryDeps,
  runBusinessQuery,
  type BusinessQueryDeps,
} from "../analytics/businessQuery";
import { reconcileLedgerSpan } from "../analytics/canonicalRevenue";
import { identityKeysFor } from "../analytics/customerIdentityResolution";
import { addDaysYmd, previousPeriod, resolvePeriod } from "../analytics/businessPeriods";
import { customerTruthDispositionOf } from "../analytics/sourceCoverage";
import type { ServiceArea } from "../../shared/lanternTerritoryAttribution";
import type { LanternReportWindowDays, LanternTerritoryReport } from "../../shared/lanternTerritoryReport";
import { loadCustomerGroups, projectGeographicCustomers } from "./customerOrderTruth";
import {
  buildLanternTerritoryReport,
  type ReportCustomer,
  type ReportSourceQuality,
} from "./lanternTerritoryReport";

export type ReportGeography = {
  basis: LanternTerritoryReport["geographyBasis"];
  areas: ServiceArea[];
};

function coordinate(value: unknown, limit: number): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

/** Tenant service geography from configured coordinates. Address labels are not read. */
export async function loadReportGeography(tenantId: string): Promise<ReportGeography> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const locations = await db
    .select({
      id: legacyDayforgeSaasTenantLocations.id,
      latitude: legacyDayforgeSaasTenantLocations.latitude,
      longitude: legacyDayforgeSaasTenantLocations.longitude,
      serviceRadiusMiles: legacyDayforgeSaasTenantLocations.serviceRadiusMiles,
    })
    .from(legacyDayforgeSaasTenantLocations)
    .where(eq(legacyDayforgeSaasTenantLocations.tenantId, tenantId));
  const areas = locations.flatMap(row => {
    const latitude = coordinate(row.latitude, 90);
    const longitude = coordinate(row.longitude, 180);
    const radiusMiles = Number(row.serviceRadiusMiles);
    if (latitude == null || longitude == null || !(radiusMiles > 0) || radiusMiles > 100) return [];
    return [{ id: `tenant-location:${row.id}`, latitude, longitude, radiusMiles }];
  });
  if (areas.length) return { basis: "tenant_location", areas };
  const [profile] = await db
    .select({
      latitude: territoryOperatorProfiles.latitude,
      longitude: territoryOperatorProfiles.longitude,
      serviceRadiusMiles: territoryOperatorProfiles.serviceRadiusMiles,
    })
    .from(territoryOperatorProfiles)
    .where(eq(territoryOperatorProfiles.tenantId, tenantId))
    .limit(1);
  const latitude = coordinate(profile?.latitude, 90);
  const longitude = coordinate(profile?.longitude, 180);
  const radiusMiles = Number(profile?.serviceRadiusMiles);
  if (latitude == null || longitude == null || !(radiusMiles > 0) || radiusMiles > 100) {
    return { basis: "none", areas: [] };
  }
  return {
    basis: "territory_operator_profile",
    areas: [{ id: `territory-profile:${tenantId}`, latitude, longitude, radiusMiles }],
  };
}

/** Located customers for this tenant only, with the identity keys the paid-order ledger already uses. */
export async function loadReportCustomers(tenantId: string, now: Date): Promise<ReportCustomer[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const timeZone = getDashboardTimeZone();
  const [groups, locations] = await Promise.all([
    loadCustomerGroups(tenantId),
    db.select().from(entityLocations).where(eq(entityLocations.tenantId, tenantId)),
  ]);
  const locationMap = new Map(locations.map(row => [`${row.entityType}:${row.entityKey}`, row]));
  return projectGeographicCustomers({
    groups,
    locationMap,
    timeZone,
    today: zonedYmd(now, timeZone),
  }).map(customer => {
    const keys = new Set<string>();
    for (const record of groups.get(customer.identityKey) ?? []) {
      for (const key of identityKeysFor({
        phone: record.phone,
        email: record.email,
        bldgUserId: record.bldgUserId,
        cleancloudCustomerId: record.cleancloudCustomerId,
      })) keys.add(key);
    }
    return {
      identityKey: customer.identityKey,
      displayName: customer.displayName,
      phone: customer.phone || null,
      latitude: customer.location?.latitude ?? null,
      longitude: customer.location?.longitude ?? null,
      geocodeStatus: customer.geocodeStatus ?? null,
      canonicalAddress: customer.location?.canonicalAddress ?? null,
      identityKeys: [...keys],
    };
  });
}

export type LanternReportLoaders = {
  loadGeography: (tenantId: string) => Promise<ReportGeography>;
  loadCustomers: (tenantId: string, now: Date) => Promise<ReportCustomer[]>;
  business: BusinessQueryDeps;
};

const defaultLoaders = (): LanternReportLoaders => ({
  loadGeography: loadReportGeography,
  loadCustomers: loadReportCustomers,
  business: defaultBusinessQueryDeps,
});

function withhold(report: LanternTerritoryReport, reason: string): LanternTerritoryReport {
  return {
    ...report,
    status: "unavailable",
    reason,
    figuresAreLive: true,
    partitionedRevenueCents: null,
    comparison: {
      mostRecordedRevenue: null,
      steepestDecline: null,
      dormantOpportunities: [],
      insufficient: [{ territoryId: "book", name: "This business", reason }],
      withheldReason: reason,
    },
    territories: report.territories.map(territory => ({
      ...territory,
      revenueCents: null,
      previousRevenueCents: null,
      revenueChangeCents: null,
      paidOrderCount: null,
      activeCustomers: null,
      dormantCustomers: null,
      direction: "unknown",
      directionReliable: false,
      evidenceNote: reason,
    })),
  };
}

/**
 * Read-only territory metrics for the authenticated tenant.
 * Revenue cents are the canonical paid-order read, then partitioned by authoritative geography.
 */
export async function readLanternTerritoryReport(input: {
  tenantId: string;
  windowDays: LanternReportWindowDays;
  now?: Date;
  loaders?: Partial<LanternReportLoaders>;
}): Promise<LanternTerritoryReport> {
  const loaders: LanternReportLoaders = { ...defaultLoaders(), ...input.loaders };
  const now = input.now ?? loaders.business.now();
  const timeZone = loaders.business.timeZone();
  const geography = await loaders.loadGeography(input.tenantId);
  const supported = buildLanternTerritoryReport({
    tenantId: input.tenantId,
    windowDays: input.windowDays,
    now,
    timeZone,
    areas: geography.areas,
    geographyBasis: geography.basis,
    customers: [],
    includedEvents: [],
    figuresAreLive: true,
  });
  if (supported.status === "unsupported_geography") return supported;

  const period = resolvePeriod({ kind: "trailing_days", days: input.windowDays }, now, timeZone);
  const comparison = previousPeriod(period, now);
  const lookbackStart = addDaysYmd(period.start, -CUSTOMER_LOOKBACK_DAYS);
  const query = {
    ...defaultBusinessQuery("revenue"),
    period: { kind: "trailing_days" as const, days: input.windowDays },
    comparison: "previous" as const,
  };
  const [customers, ledger, snapshot] = await Promise.all([
    loaders.loadCustomers(input.tenantId, now),
    loaders.business.loadLedger({
      tenantId: input.tenantId,
      startUtc: zonedDayStartUtc(lookbackStart, timeZone),
      endExclusiveUtc: period.endExclusiveUtc,
      timeZone,
    }),
    loaders.business.readSourceCoverage
      ? loaders.business.readSourceCoverage({
          tenantId: input.tenantId,
          from: period.start,
          to: period.end,
          now,
        })
      : Promise.resolve(null),
  ]);
  const business = await runBusinessQuery(input.tenantId, query, {
    ...loaders.business,
    loadLedger: async () => ledger,
  });

  if (business.status !== "ok" || business.data.kind !== "totals") {
    return withhold(
      supported,
      business.status === "unavailable" ? business.reason : "The canonical revenue read is unavailable."
    );
  }

  const comparable = reconcileLedgerSpan(ledger, { start: comparison.start, end: period.end });
  const history = reconcileLedgerSpan(ledger, { start: lookbackStart, end: period.end });
  const older = history.includedEvents.filter(event => event.businessDate < comparison.start);
  const includedEvents = [...comparable.includedEvents, ...older];
  const unverified = ledger.unverifiedNative.filter(
    order => order.businessDate >= period.start && order.businessDate <= period.end
  );
  const coverage = business.coverage;
  const canonical = coverage?.canonicalRevenue;
  const bookStatus = snapshot?.book.status ?? "unavailable";
  const failedSources = coverage?.failedSources ?? ledger.failedSources;
  const freshComplete =
    bookStatus === "fresh" &&
    coverage?.completeness === "complete" &&
    failedSources.length === 0 &&
    canonical?.mayStateExact === true &&
    canonical.comparisonMayStateExact === true;
  const disposition = customerTruthDispositionOf(snapshot);
  const source: ReportSourceQuality = {
    bookStatus,
    completeness: coverage?.completeness ?? ledger.completeness,
    loadedSources: coverage?.loadedSources ?? ledger.loadedSources,
    failedSources,
    checkedAt: snapshot?.checkedAt ?? null,
    mayStateExact: canonical?.mayStateExact === true,
    comparisonMayStateExact: canonical?.comparisonMayStateExact === true,
    customerCountsReliable: disposition === "current" && bookStatus === "fresh" && failedSources.length === 0,
    sourcesAllowChange: freshComplete,
    emptyIsReal:
      bookStatus === "fresh" &&
      coverage?.completeness === "complete" &&
      failedSources.length === 0 &&
      snapshot?.book.interpretEmptyAsNoCustomers === true,
    notes: [
      ...(coverage?.loadedSources ?? ledger.loadedSources).map(sourceId => `Loaded ${sourceId}.`),
      ...failedSources.map(sourceId => `${sourceId} could not be read.`),
      bookStatus === "fresh" ? "Source coverage is fresh for this check." : `Source coverage is ${bookStatus}.`,
    ],
  };
  const report = buildLanternTerritoryReport({
    tenantId: input.tenantId,
    windowDays: input.windowDays,
    now,
    timeZone,
    areas: geography.areas,
    geographyBasis: geography.basis,
    customers,
    includedEvents,
    missingPaymentEvidence: {
      orderCount: unverified.length,
      cents: unverified.reduce((sum, order) => sum + order.cents, 0),
    },
    source,
    figuresAreLive: true,
  });
  if (report.status !== "ready") return report;
  if (report.partitionedRevenueCents == null) {
    return withhold(report, "Territory totals could not be partitioned without double-counting.");
  }
  if (report.partitionedRevenueCents !== business.data.current.revenueCents) {
    return withhold(report, "Territory totals do not match the canonical revenue read, so they are withheld.");
  }
  return report;
}
