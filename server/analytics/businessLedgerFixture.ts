import type { CleanCloudOrderRow, LedgerLoaders, NativeOrderRow } from "./paidOrderLedger";
import { ALWAYS_MISSING_SOURCES, type DataCompleteness } from "./analyticsQueries";
import type { BusinessSourceCoverage, BusinessSourceCoverageSnapshot } from "./sourceCoverage";

/**
 * Deterministic business fixture shared by analytics and Claire tests.
 * "Now" is Monday September 14, 2026, 7pm in Los Angeles.
 *
 * Last 30 days (Aug 16–Sep 14): $190 across 5 orders (Ava 2, Cara 2, Ben 1).
 * The 30 days before (Jul 17–Aug 15): $95 across 2 orders (Ava, Eli).
 * One native order marked paid without Stripe evidence ($70, Sep 1).
 */

export const FIXTURE_NOW = new Date("2026-09-15T02:00:00.000Z");
export const FIXTURE_TZ = "America/Los_Angeles";

const noonLA = (ymd: string) => new Date(`${ymd}T19:00:00.000Z`);

type Person = { first: string; last: string; phone: string | null; email?: string | null; cleancloudId?: string | null };

const AVA: Person = { first: "Ava", last: "Stone", phone: "3105550100" };
const CARA: Person = { first: "Cara", last: "Diaz", phone: "3105550122", email: "cara@example.com" };
const ELI: Person = { first: "Eli", last: "Park", phone: "3105550133" };
const BEN: Person = { first: "Ben", last: "Ortiz", phone: "310-555-0199", cleancloudId: "c-ben" };
const DEE: Person = { first: "Dee", last: "Lopez", phone: null, email: "dee@example.com", cleancloudId: "c-dee" };

function native(
  id: number,
  ymd: string,
  total: string,
  person: Person,
  extra: Partial<NativeOrderRow> = {}
): NativeOrderRow {
  return {
    id,
    paid: true,
    paidAt: noonLA(ymd),
    total,
    stripePaymentIntentId: `pi_${id}`,
    serviceType: "wash_fold",
    firstName: person.first,
    lastName: person.last,
    phone: person.phone,
    email: person.email ?? null,
    bldgUserId: null,
    ...extra,
  };
}

function cleancloud(
  id: string,
  ymd: string,
  totalCents: number,
  person: Person,
  extra: Partial<CleanCloudOrderRow> = {}
): CleanCloudOrderRow {
  return {
    cleancloudOrderId: id,
    cleancloudCustomerId: person.cleancloudId ?? null,
    sourceReportType: "orders_sales",
    paymentDateUtc: noonLA(ymd),
    paidDateUtc: null,
    paid: true,
    totalCents,
    customerName: `${person.first} ${person.last}`,
    customerPhone: person.phone,
    customerEmail: person.email ?? null,
    ...extra,
  };
}

export const fixtureNativeRows: NativeOrderRow[] = [
  native(1, "2026-09-10", "60.00", AVA),
  native(2, "2026-09-12", "40.00", AVA),
  native(3, "2026-08-01", "50.00", AVA),
  native(4, "2026-08-20", "25.00", CARA, { serviceType: "dry_cleaning" }),
  native(5, "2026-08-25", "35.00", CARA, { serviceType: "dry_cleaning" }),
  native(6, "2026-08-10", "45.00", ELI),
  native(99, "2026-09-01", "70.00", { first: "Zed", last: "Proxy", phone: "3105550777" }, { stripePaymentIntentId: null }),
];

export const fixtureCleanCloudRows: CleanCloudOrderRow[] = [
  cleancloud("cc-ben-1", "2026-09-05", 3000, BEN),
  cleancloud("cc-ben-1", "2026-09-05", 3000, BEN, {
    sourceReportType: "orders_revenue",
    paymentDateUtc: null,
    paidDateUtc: noonLA("2026-09-05"),
  }),
  cleancloud("cc-ben-0", "2026-07-01", 3000, BEN),
  cleancloud("cc-dee-1", "2026-06-20", 8000, DEE),
];

export function fixtureLoaders(seenTenants: string[] = []): LedgerLoaders {
  return {
    laundry_butler: async window => {
      seenTenants.push(window.tenantId);
      return fixtureNativeRows;
    },
    cleancloud: async window => {
      seenTenants.push(window.tenantId);
      return fixtureCleanCloudRows;
    },
  };
}

export const failingLoaders: LedgerLoaders = {
  laundry_butler: async () => {
    throw new Error("database unreachable");
  },
  cleancloud: async () => {
    throw new Error("database unreachable");
  },
};

export const emptyLoaders: LedgerLoaders = {
  laundry_butler: async () => [],
  cleancloud: async () => [],
};

function provenSource(sourceId: "laundry_butler" | "cleancloud"): BusinessSourceCoverage {
  const cleancloud = sourceId === "cleancloud";
  return {
    sourceId,
    name: cleancloud ? "CleanCloud" : "Laundry Butler",
    type: cleancloud ? "cleancloud_paid_book" : "native_orders",
    availability: "available",
    includedInCombinedBook: true,
    status: "fresh",
    lastSuccessfulAssimilationAt: cleancloud ? "2026-09-15T18:00:00.000Z" : null,
    assimilationKind: cleancloud ? "customer_truth_refreshed" : "not_applicable",
    coveredThrough: cleancloud ? "2099-12-31" : null,
    provenFrom: cleancloud ? "2020-01-01" : null,
    expectedThrough: cleancloud ? "2099-12-31" : null,
    records: "readable",
    supportsExhaustiveCurrentClaim: true,
    emptyReadMeansNoRecords: false,
    reason: "Fixture sources are held and fresh for the proven span.",
    provenance: {
      bindingState: "bound",
      schedule: cleancloud ? "gumball_daily_18_america_los_angeles" : "system_of_record",
      coverageBasis: "economic_event",
      receiptProvenance: "test_fixture",
      paymentEventsProven: true,
      decidedBy: "deterministic_rules",
    },
  };
}

/** Held sources fresh, payment events proven, span covers the fixture ledger. Not a live provider. */
export function provenBusinessCoverageSnapshot(tenantId = "tenant-1"): BusinessSourceCoverageSnapshot {
  return {
    contractVersion: 1,
    tenantId,
    checkedAt: "2026-09-15T16:40:00.000Z",
    timeZone: "America/Los_Angeles",
    sources: [provenSource("laundry_butler"), provenSource("cleancloud")],
    book: {
      status: "fresh",
      exhaustiveCurrent: true,
      current: true,
      scope: {
        native: "system_of_record",
        cleancloudOrdersCreated: { from: "2020-01-01", through: "2099-12-31" },
        cleancloudEconomicEvents: { from: "2020-01-01", through: "2099-12-31" },
      },
      paymentEventsProven: true,
      knownRecordsReadable: true,
      interpretEmptyAsNoCustomers: false,
      outsideProvenSpan: "unknown_not_empty",
      allCustomersLicensed: false,
      staleIsZero: false,
      missingIsNoCustomers: false,
    },
    blockingSources: [],
  };
}

export const fixtureCompleteness: DataCompleteness = {
  connected: [
    { source: "Stripe-paid orders", description: "Native Goldline orders with Stripe payment evidence" },
    { source: "CleanCloud import", description: "Paid CleanCloud orders, counted once per order" },
  ],
  missing: ALWAYS_MISSING_SOURCES,
};
