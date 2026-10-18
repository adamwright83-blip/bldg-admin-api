/**
 * Read-only Lantern territory metrics against disposable MySQL.
 *
 *   docker run -d --name lantern-report-mysql -e MYSQL_ROOT_PASSWORD=test-only \
 *     -e MYSQL_DATABASE=lantern_report_test -p 3318:3306 mysql:8.0
 *   DATABASE_URL=mysql://root:test-only@127.0.0.1:3318/lantern_report_test \
 *     pnpm vitest run --config vitest.integration.config.ts \
 *     server/geography/lanternTerritoryReport.mysql.integration.test.ts
 *
 * The test creates only the tenant-location table it reads, inserts two disposable
 * tenants, and deletes those rows. It does not migrate or touch production.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { defaultBusinessQueryDeps, type BusinessQueryDeps } from "../analytics/businessQuery";
import type { PaidOrderEvent, PaidOrderLedger } from "../analytics/paidOrderLedger";
import { loadReportGeography, readLanternTerritoryReport } from "./lanternTerritoryReportService";

const databaseUrl = process.env.DATABASE_URL;
const describeMysql = databaseUrl ? describe : describe.skip;
const NOW = new Date("2026-10-18T18:00:00.000Z");

function order(partial: Partial<PaidOrderEvent> & Pick<PaidOrderEvent, "eventKey" | "businessDate" | "cents" | "identity">): PaidOrderEvent {
  return {
    source: "laundry_butler",
    occurredAt: new Date(`${partial.businessDate}T15:00:00.000Z`),
    serviceType: null,
    customerName: "Disposable Customer",
    ...partial,
  };
}

describeMysql("lantern territory report reads disposable MySQL without writing", () => {
  let db: mysql.Connection;
  const suffix = Date.now().toString(36);
  const losAngeles = `lantern-report-la-${suffix}`;
  const desMoines = `lantern-report-dm-${suffix}`;

  beforeAll(async () => {
    db = await mysql.createConnection(databaseUrl!);
    await db.query(`
      CREATE TABLE IF NOT EXISTS dayforge_saas_tenant_locations (
        id int NOT NULL AUTO_INCREMENT,
        tenantId varchar(64) NOT NULL,
        latitude decimal(10,7) DEFAULT NULL,
        longitude decimal(10,7) DEFAULT NULL,
        serviceRadiusMiles decimal(6,2) NOT NULL,
        PRIMARY KEY (id)
      )
    `);
    await db.query("DELETE FROM dayforge_saas_tenant_locations WHERE tenantId IN (?, ?)", [losAngeles, desMoines]);
    await db.query(
      "INSERT INTO dayforge_saas_tenant_locations (tenantId, latitude, longitude, serviceRadiusMiles) VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
      [losAngeles, 34.0989, -118.33919, 8, desMoines, 41.59, -93.62, 5]
    );
  });

  afterAll(async () => {
    if (!db) return;
    await db.query("DELETE FROM dayforge_saas_tenant_locations WHERE tenantId IN (?, ?)", [losAngeles, desMoines]);
    await db.end();
  });

  it("reads one tenant's configured geography and does not change the table", async () => {
    const [beforeRows] = await db.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM dayforge_saas_tenant_locations WHERE tenantId IN (?, ?)",
      [losAngeles, desMoines]
    );
    const beforeStamp = await db.query<mysql.RowDataPacket[]>(
      "SELECT id, tenantId, latitude, longitude, serviceRadiusMiles FROM dayforge_saas_tenant_locations WHERE tenantId IN (?, ?) ORDER BY tenantId",
      [losAngeles, desMoines]
    );
    const losAngelesGeography = await loadReportGeography(losAngeles);
    const desMoinesGeography = await loadReportGeography(desMoines);
    expect(losAngelesGeography.basis).toBe("tenant_location");
    expect(losAngelesGeography.areas).toHaveLength(1);
    expect(losAngelesGeography.areas[0]).toMatchObject({ latitude: 34.0989, longitude: -118.33919 });
    expect(desMoinesGeography.areas[0]).toMatchObject({ latitude: 41.59, longitude: -93.62 });

    const events = [
      order({ eventKey: `native:${suffix}`, businessDate: "2026-10-02", cents: 8800, identity: { phone: "3105550144" } }),
    ];
    const ledger: PaidOrderLedger = {
      startUtc: new Date("2025-09-01T00:00:00.000Z"),
      endExclusiveUtc: new Date("2026-10-19T00:00:00.000Z"),
      timeZone: "UTC",
      events,
      unverifiedNative: [],
      provenDuplicateExclusions: [],
      loadedSources: ["laundry_butler"],
      failedSources: [],
      completeness: "complete",
    };
    const business: BusinessQueryDeps = {
      ...defaultBusinessQueryDeps,
      loadLedger: vi.fn(async () => ledger),
      now: () => NOW,
      timeZone: () => "UTC",
      readSourceCoverage: async () => null,
    };
    const report = await readLanternTerritoryReport({
      tenantId: losAngeles,
      windowDays: 30,
      now: NOW,
      loaders: {
        business,
        loadCustomers: async tenantId => {
          expect(tenantId).toBe(losAngeles);
          return [{
            identityKey: "ada",
            displayName: "Disposable Ada",
            phone: "3105550144",
            latitude: 34.0989,
            longitude: -118.33919,
            geocodeStatus: "success",
            canonicalAddress: "100 Disposable St",
            identityKeys: ["phone:3105550144"],
          }];
        },
      },
    });
    const other = await readLanternTerritoryReport({
      tenantId: desMoines,
      windowDays: 30,
      now: NOW,
      loaders: {
        business,
        loadCustomers: async () => {
          throw new Error("another tenant's customers must not be read");
        },
      },
    });
    expect(report.tenantId).toBe(losAngeles);
    expect(report.status).toBe("ready");
    expect(report.figuresAreLive).toBe(true);
    expect(report.territories.find(territory => territory.id === "hollywood")?.revenueCents).toBe(8800);
    expect(report.partitionedRevenueCents).toBe(8800);
    expect(other.status).toBe("unsupported_geography");
    expect(other.territories).toEqual([]);
    expect(business.loadLedger).toHaveBeenCalledTimes(1);

    const [afterRows] = await db.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM dayforge_saas_tenant_locations WHERE tenantId IN (?, ?)",
      [losAngeles, desMoines]
    );
    const afterStamp = await db.query<mysql.RowDataPacket[]>(
      "SELECT id, tenantId, latitude, longitude, serviceRadiusMiles FROM dayforge_saas_tenant_locations WHERE tenantId IN (?, ?) ORDER BY tenantId",
      [losAngeles, desMoines]
    );
    expect(afterRows[0]!.count).toBe(beforeRows[0]!.count);
    expect(afterStamp[0]).toEqual(beforeStamp[0]);
  });
});
