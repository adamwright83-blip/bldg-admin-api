import { describe, expect, it, vi } from "vitest";
import { LANTERN_TERRITORIES, type LanternTerritory } from "../../shared/lanternTerritories";
import {
  attributeLanternPoint,
  streetIdentity,
  territoriesInServiceAreas,
} from "../../shared/lanternTerritoryAttribution";
import {
  defaultBusinessQueryDeps,
  runBusinessQuery,
  type BusinessQueryDeps,
} from "../analytics/businessQuery";
import type { PaidOrderEvent, PaidOrderLedger } from "../analytics/paidOrderLedger";
import { buildLanternTerritoryReport, type ReportCustomer, type ReportSourceQuality } from "../analytics/lanternTerritoryReport";
import { readLanternTerritoryReport } from "../analytics/lanternTerritoryReportService";

const NOW = new Date("2026-10-18T18:00:00.000Z");
const TZ = "UTC";

const FRESH: ReportSourceQuality = {
  bookStatus: "fresh",
  completeness: "complete",
  loadedSources: ["laundry_butler"],
  failedSources: [],
  checkedAt: "2026-10-18T18:00:00.000Z",
  mayStateExact: true,
  comparisonMayStateExact: true,
  customerCountsReliable: true,
  sourcesAllowChange: true,
  emptyIsReal: true,
  notes: ["Loaded laundry_butler."],
};

function box(
  id: string,
  name: string,
  west: number,
  south: number,
  east: number,
  north: number,
  parent: string | null = null
): LanternTerritory {
  return {
    id,
    name,
    aliases: [name],
    geometry: {
      type: "Polygon",
      coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
    },
    presentation: {
      cloudBounds: { xPct: 0, yPct: 0, widthPct: 1, heightPct: 1 },
      guardianAnchor: { xPct: 0, yPct: 0, scale: 1 },
      lockAnchor: { xPct: 0, yPct: 0, scale: 1 },
      majorLabel: false,
    },
    initialState: "queued",
    initialGuardianId: null,
    sourceType: "mapping_la_v5",
    parentTerritory: parent,
    boundaryBasis: null,
  };
}

function customer(partial: Partial<ReportCustomer> & Pick<ReportCustomer, "identityKey">): ReportCustomer {
  return {
    displayName: partial.identityKey,
    phone: "3105550100",
    latitude: 34.0989,
    longitude: -118.33919,
    geocodeStatus: "success",
    canonicalAddress: "100 Main St",
    identityKeys: ["phone:3105550100"],
    ...partial,
  };
}

function order(partial: Partial<PaidOrderEvent> & Pick<PaidOrderEvent, "eventKey" | "businessDate" | "cents">): PaidOrderEvent {
  return {
    source: "laundry_butler",
    occurredAt: new Date(`${partial.businessDate}T15:00:00.000Z`),
    serviceType: null,
    customerName: "Fixture Customer",
    identity: { phone: "3105550100" },
    ...partial,
  };
}

const laArea = { id: "la", latitude: 34.08, longitude: -118.35, radiusMiles: 20 };
const boxes = [
  box("alpha", "Alpha", -118.5, 34.0, -118.4, 34.1),
  box("beta", "Beta", -118.2, 34.0, -118.1, 34.1),
  box("tiny", "Tiny", -118.05, 34.0, -118.0, 34.05),
];

function report(partial: Parameters<typeof buildLanternTerritoryReport>[0]) {
  return buildLanternTerritoryReport({
    tenantId: "tenant-a",
    windowDays: 30,
    now: NOW,
    timeZone: TZ,
    areas: [laArea],
    geographyBasis: "tenant_location",
    customers: [],
    includedEvents: [],
    source: FRESH,
    ...partial,
  });
}

describe("lantern territory attribution", () => {
  it("uses the point, not an address that resembles another territory", () => {
    const hollywood = attributeLanternPoint({
      latitude: 34.0989,
      longitude: -118.33919,
      premiseStreet: streetIdentity("100 Silver Lake Blvd, Hollywood"),
      territories: LANTERN_TERRITORIES,
    });
    const silverLake = attributeLanternPoint({
      latitude: 34.09825,
      longitude: -118.26459,
      premiseStreet: streetIdentity("6801 Hollywood Blvd"),
      territories: LANTERN_TERRITORIES,
    });
    expect(hollywood).toMatchObject({ status: "assigned", territoryId: "hollywood" });
    expect(silverLake).toMatchObject({ status: "assigned", territoryId: "silver-lake" });
    expect(streetIdentity("100 Silver Lake Blvd, Hollywood")).toBe("100 silver");
  });

  it("keeps the Century Park East towers on the shared premise, not the word Century", () => {
    const tower = attributeLanternPoint({
      latitude: 34.0989,
      longitude: -118.33919,
      premiseStreet: streetIdentity("2170 Century Park East, Los Angeles, CA 90067"),
      territories: LANTERN_TERRITORIES,
    });
    const similarName = attributeLanternPoint({
      latitude: 34.0989,
      longitude: -118.33919,
      premiseStreet: streetIdentity("100 Century City Blvd"),
      territories: LANTERN_TERRITORIES,
    });
    expect(tower).toMatchObject({ status: "assigned", territoryId: "century-city" });
    expect(similarName).toMatchObject({ status: "assigned", territoryId: "hollywood" });
  });

  it("does not treat a configured label as geography", () => {
    const namedHollywood = territoriesInServiceAreas(
      [{ id: "fake", latitude: 41.59, longitude: -93.62, radiusMiles: 5 }],
      LANTERN_TERRITORIES
    );
    expect(namedHollywood).toEqual([]);
    const placed = territoriesInServiceAreas(
      [{ id: "store", latitude: 34.0989, longitude: -118.33919, radiusMiles: 0.2 }],
      LANTERN_TERRITORIES
    );
    expect(placed.some(territory => territory.id === "hollywood")).toBe(true);
    expect(placed.some(territory => territory.id === "silver-lake")).toBe(false);
  });

  it("withholds overlapping areas instead of counting both", () => {
    const overlap = [
      box("left", "Left", -118.3, 34.0, -118.1, 34.2),
      box("right", "Right", -118.2, 34.0, -118.0, 34.2),
    ];
    expect(
      attributeLanternPoint({
        latitude: 34.1,
        longitude: -118.15,
        premiseStreet: null,
        territories: overlap,
      }).status
    ).toBe("ambiguous");
    const result = report({
      areas: [{ id: "mid", latitude: 34.1, longitude: -118.15, radiusMiles: 5 }],
      territories: overlap,
      customers: [
        customer({
          identityKey: "overlap",
          latitude: 34.1,
          longitude: -118.15,
          canonicalAddress: "1 Left Right St",
          identityKeys: ["phone:3105550141"],
        }),
      ],
      includedEvents: [order({ eventKey: "order:overlap", businessDate: "2026-10-02", cents: 5000, identity: { phone: "3105550141" } })],
    });
    expect(result.ambiguous).toEqual({ revenueCents: 5000, orderCount: 1 });
    expect(result.territories.every(territory => territory.revenueCents === 0)).toBe(true);
    expect(result.partitionedRevenueCents).toBe(5000);
    expect(result.comparison.mostRecordedRevenue).toBeNull();
    expect(result.comparison.withheldReason).toMatch(/withheld/i);
  });

  it("counts a child territory once when it sits inside its parent", () => {
    const nested = [
      box("parent", "Parent", -118.3, 34.0, -118.0, 34.3),
      box("child", "Child", -118.2, 34.1, -118.1, 34.2, "parent"),
    ];
    const result = report({
      areas: [{ id: "mid", latitude: 34.15, longitude: -118.15, radiusMiles: 8 }],
      territories: nested,
      customers: [customer({ identityKey: "child", latitude: 34.15, longitude: -118.15, identityKeys: ["phone:3105550142"] })],
      includedEvents: [order({ eventKey: "order:child", businessDate: "2026-10-03", cents: 2500, identity: { phone: "3105550142" } })],
    });
    expect(result.territories.find(territory => territory.id === "child")?.revenueCents).toBe(2500);
    expect(result.territories.find(territory => territory.id === "parent")?.revenueCents).toBe(0);
    expect(result.partitionedRevenueCents).toBe(2500);
  });
});

describe("lantern territory comparison", () => {
  const customers: ReportCustomer[] = [
    customer({ identityKey: "ada", displayName: "Ada", phone: "3105550101", latitude: 34.0989, longitude: -118.33919, identityKeys: ["phone:3105550101"], canonicalAddress: "10 Hill St" }),
    customer({ identityKey: "bea", displayName: "Bea", phone: "3105550102", latitude: 34.09825, longitude: -118.26459, identityKeys: ["phone:3105550102"], canonicalAddress: "20 Lake St" }),
    customer({ identityKey: "cy", displayName: "Cy", phone: "3105550103", latitude: 34.06247, longitude: -118.30231, identityKeys: ["phone:3105550103"], canonicalAddress: "30 Small St" }),
    customer({ identityKey: "quiet", displayName: "Quiet", phone: "3105550104", latitude: 34.09825, longitude: -118.26459, identityKeys: ["phone:3105550104"], canonicalAddress: "40 Dormant St" }),
  ];
  const events = [
    order({ eventKey: "ada-now", businessDate: "2026-10-02", cents: 10000, identity: { phone: "3105550101" } }),
    order({ eventKey: "ada-then", businessDate: "2026-09-02", cents: 2000, identity: { phone: "3105550101" } }),
    order({ eventKey: "bea-now", businessDate: "2026-10-04", cents: 1000, identity: { phone: "3105550102" } }),
    order({ eventKey: "bea-then", businessDate: "2026-09-04", cents: 8000, identity: { phone: "3105550102" } }),
    order({ eventKey: "cy-now", businessDate: "2026-10-06", cents: 100, identity: { phone: "3105550103" } }),
    order({ eventKey: "cy-then", businessDate: "2026-09-06", cents: 100, identity: { phone: "3105550103" } }),
    order({ eventKey: "quiet-then", businessDate: "2026-09-01", cents: 400, identity: { phone: "3105550104" } }),
  ];

  it("names the highest recorded revenue and the steepest decline, not the smallest territory", () => {
    const result = report({ customers, includedEvents: events });
    expect(result.comparison.mostRecordedRevenue).toMatchObject({ territoryId: "hollywood", revenueCents: 10000 });
    expect(result.comparison.steepestDecline).toMatchObject({ territoryId: "silver-lake", revenueChangeCents: -7400 });
    expect(result.comparison.steepestDecline?.territoryId).not.toBe("koreatown");
    expect(result.territories.find(territory => territory.id === "koreatown")?.revenueCents).toBe(100);
    expect(JSON.stringify(result)).not.toMatch(/worst/i);
    const silver = result.territories.find(territory => territory.id === "silver-lake")!;
    expect(silver.direction).toBe("down");
    expect(silver.directionReliable).toBe(true);
    expect(silver.dormantCustomers).toBe(1);
    expect(result.comparison.dormantOpportunities.map(item => item.territoryId)).toContain("silver-lake");
    expect(result.partitionedRevenueCents).toBe(11100);
  });

  it("does not highlight change or rank a decline when the book is stale", () => {
    const result = report({
      customers,
      includedEvents: events,
      source: { ...FRESH, bookStatus: "stale", mayStateExact: false, comparisonMayStateExact: false, sourcesAllowChange: false, customerCountsReliable: false, emptyIsReal: false },
    });
    expect(result.territories.find(territory => territory.id === "hollywood")?.revenueCents).toBe(10000);
    expect(result.territories.every(territory => territory.direction === "unknown")).toBe(true);
    expect(result.comparison.steepestDecline).toBeNull();
    expect(result.comparison.dormantOpportunities).toEqual([]);
    expect(result.comparison.insufficient.map(item => item.territoryId)).toEqual(expect.arrayContaining(["change", "dormant"]));
  });

  it("does not invent a zero or a rank when payment evidence is missing", () => {
    const result = report({
      customers,
      includedEvents: events,
      missingPaymentEvidence: { orderCount: 2, cents: 900 },
    });
    expect(result.comparison.mostRecordedRevenue).toBeNull();
    expect(result.comparison.steepestDecline).toBeNull();
    expect(result.missingPaymentEvidence).toEqual({ orderCount: 2, cents: 900 });
    expect(result.comparison.insufficient.map(item => item.territoryId)).toContain("payment");
  });

  it("leaves ungeocoded customers unattributed instead of matching their address text", () => {
    const result = report({
      customers: [
        customer({
          identityKey: "lost",
          latitude: null,
          longitude: null,
          geocodeStatus: "pending",
          canonicalAddress: "500 Hollywood Blvd",
          identityKeys: ["phone:3105550199"],
        }),
      ],
      includedEvents: [order({ eventKey: "lost-order", businessDate: "2026-10-08", cents: 4242, identity: { phone: "3105550199" } })],
    });
    expect(result.unattributed).toEqual({ revenueCents: 4242, orderCount: 1 });
    expect(result.territories.find(territory => territory.id === "hollywood")?.revenueCents).toBe(0);
    expect(result.comparison.mostRecordedRevenue).toBeNull();
  });

  it("does not double-count one order when two identity records share it", () => {
    const result = report({
      territories: boxes,
      areas: [{ id: "wide", latitude: 34.05, longitude: -118.3, radiusMiles: 40 }],
      customers: [
        customer({ identityKey: "a", latitude: 34.05, longitude: -118.45, identityKeys: ["phone:3105550177", "email:a@example.invalid"] }),
        customer({ identityKey: "b", latitude: 34.05, longitude: -118.15, identityKeys: ["phone:3105550177"] }),
      ],
      includedEvents: [
        order({ eventKey: "once", businessDate: "2026-10-02", cents: 3000, identity: { phone: "3105550177" } }),
        order({ eventKey: "once", businessDate: "2026-10-02", cents: 3000, identity: { phone: "3105550177" } }),
      ],
    });
    expect(result.ambiguous.revenueCents).toBe(3000);
    expect(result.partitionedRevenueCents).toBe(3000);
    expect(result.territories.reduce((sum, territory) => sum + (territory.revenueCents ?? 0), 0)).toBe(0);
  });

  it("fails closed for a business configured outside Lantern City", () => {
    const result = report({
      tenantId: "des-moines",
      areas: [{ id: "store", latitude: 41.59, longitude: -93.62, radiusMiles: 5 }],
      customers: [customer({ identityKey: "local", canonicalAddress: "1 Hollywood Ave, Des Moines" })],
      includedEvents: [order({ eventKey: "dm", businessDate: "2026-10-02", cents: 9999 })],
    });
    expect(result.status).toBe("unsupported_geography");
    expect(result.territories).toEqual([]);
    expect(result.reason).toMatch(/does not reach/i);
    expect(result.partitionedRevenueCents).toBeNull();
  });

  it("counts an Arts District order once, not again in Downtown", () => {
    const result = report({
      customers: [
        customer({
          identityKey: "arts",
          latitude: 34.0452,
          longitude: -118.234,
          identityKeys: ["phone:3105550188"],
          canonicalAddress: "100 Arts St",
        }),
      ],
      includedEvents: [order({ eventKey: "arts-order", businessDate: "2026-10-09", cents: 6400, identity: { phone: "3105550188" } })],
    });
    expect(result.territories.find(territory => territory.id === "arts-district")?.revenueCents).toBe(6400);
    expect(result.territories.find(territory => territory.id === "downtown")?.revenueCents).toBe(0);
    expect(result.partitionedRevenueCents).toBe(6400);
  });
});

describe("lantern territory report service", () => {
  it("matches the canonical revenue read and isolates the tenant", async () => {
    const events = [
      order({ eventKey: "ada-now", businessDate: "2026-10-02", cents: 10000, identity: { phone: "3105550101" } }),
      order({ eventKey: "bea-now", businessDate: "2026-10-04", cents: 1000, identity: { phone: "3105550102" } }),
    ];
    const ledger: PaidOrderLedger = {
      startUtc: new Date("2025-01-01T00:00:00.000Z"),
      endExclusiveUtc: new Date("2026-10-19T00:00:00.000Z"),
      timeZone: TZ,
      events,
      unverifiedNative: [],
      provenDuplicateExclusions: [],
      loadedSources: ["laundry_butler"],
      failedSources: [],
      completeness: "complete",
    };
    const business: BusinessQueryDeps = {
      ...defaultBusinessQueryDeps,
      loadLedger: async () => ledger,
      now: () => NOW,
      timeZone: () => TZ,
      readSourceCoverage: async () => null,
    };
    const canonical = await runBusinessQuery(
      "tenant-a",
      { ...({ metric: "revenue", period: { kind: "trailing_days", days: 30 }, comparison: "previous", serviceType: null, minOrders: 1, limit: 5, customerName: null, listMembers: false }) },
      business
    );
    expect(canonical.status).toBe("ok");
    if (canonical.status !== "ok" || canonical.data.kind !== "totals") return;
    const seen: string[] = [];
    const result = await readLanternTerritoryReport({
      tenantId: "tenant-a",
      windowDays: 30,
      now: NOW,
      loaders: {
        business,
        loadGeography: async tenantId => {
          seen.push(tenantId);
          return { basis: "tenant_location", areas: [laArea] };
        },
        loadCustomers: async tenantId => {
          seen.push(tenantId);
          if (tenantId !== "tenant-a") {
            return [customer({ identityKey: "other", identityKeys: ["phone:19995550199"] })];
          }
          return [
            customer({ identityKey: "ada", latitude: 34.0989, longitude: -118.33919, identityKeys: ["phone:3105550101"] }),
            customer({ identityKey: "bea", latitude: 34.09825, longitude: -118.26459, identityKeys: ["phone:3105550102"] }),
          ];
        },
      },
    });
    expect(seen).toEqual(["tenant-a", "tenant-a"]);
    expect(result.status).toBe("ready");
    expect(result.figuresAreLive).toBe(true);
    expect(result.partitionedRevenueCents).toBe(canonical.data.current.revenueCents);
    expect(result.territories.find(territory => territory.id === "hollywood")?.revenueCents).toBe(10000);
    expect(result.territories.find(territory => territory.id === "silver-lake")?.revenueCents).toBe(1000);
  });

  it("withholds territory figures when a CleanCloud resync leaves the current import without a receipt", async () => {
    const ledger: PaidOrderLedger = {
      startUtc: new Date("2025-01-01T00:00:00.000Z"),
      endExclusiveUtc: new Date("2026-10-19T00:00:00.000Z"),
      timeZone: TZ,
      events: [order({ eventKey: "ada-now", businessDate: "2026-10-02", cents: 10000, identity: { phone: "3105550101" } })],
      unverifiedNative: [],
      unverifiedPaymentAuthority: [{
        eventKey: "cleancloud:sl-1",
        businessDate: "2026-10-03",
        source: "cleancloud",
        cents: 4500,
        reason: "missing_or_invalid_receipt",
      }],
      provenDuplicateExclusions: [],
      loadedSources: ["laundry_butler", "cleancloud"],
      failedSources: ["cleancloud"],
      completeness: "partial",
    };
    const result = await readLanternTerritoryReport({
      tenantId: "tenant-a",
      windowDays: 30,
      now: NOW,
      loaders: {
        business: {
          ...defaultBusinessQueryDeps,
          loadLedger: async () => ledger,
          now: () => NOW,
          timeZone: () => TZ,
          readSourceCoverage: async () => null,
        },
        loadGeography: async () => ({ basis: "tenant_location", areas: [laArea] }),
        loadCustomers: async () => [
          customer({ identityKey: "ada", latitude: 34.0989, longitude: -118.33919, identityKeys: ["phone:3105550101"] }),
          customer({ identityKey: "bea", latitude: 34.09825, longitude: -118.26459, identityKeys: ["phone:3105550102"] }),
        ],
      },
    });
    expect(result.status).toBe("unavailable");
    expect(result.partitionedRevenueCents).toBeNull();
    expect(result.comparison.mostRecordedRevenue).toBeNull();
    expect(result.comparison.steepestDecline).toBeNull();
    expect(result.comparison.dormantOpportunities).toEqual([]);
    expect(result.territories.every(territory => territory.revenueCents == null)).toBe(true);
    expect(result.reason).toMatch(/payment time/);
    expect(result.reason).toMatch(/withheld/);
    expect(JSON.stringify(result.territories)).not.toContain("10000");
    expect(JSON.stringify(result.territories)).not.toContain("4500");
  });

  it("does not read the paid-order book when geography is unsupported", async () => {
    const loadLedger = vi.fn();
    const result = await readLanternTerritoryReport({
      tenantId: "tenant-b",
      windowDays: 90,
      now: NOW,
      loaders: {
        business: { ...defaultBusinessQueryDeps, loadLedger, now: () => NOW, timeZone: () => TZ },
        loadGeography: async () => ({ basis: "tenant_location", areas: [{ id: "dm", latitude: 41.59, longitude: -93.62, radiusMiles: 5 }] }),
        loadCustomers: async () => {
          throw new Error("customers must not be read");
        },
      },
    });
    expect(result.status).toBe("unsupported_geography");
    expect(result.tenantId).toBe("tenant-b");
    expect(loadLedger).not.toHaveBeenCalled();
  });
});
