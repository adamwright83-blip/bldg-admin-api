import { describe, expect, it, vi, beforeEach } from "vitest";

const getDbMock = vi.fn();
vi.mock("../db", () => ({
  getDb: () => getDbMock(),
}));

const getCommercialMissionByIdempotencyKey = vi.fn();
vi.mock("../commercialMissions/commercialMissionStore", () => ({
  getCommercialMissionByIdempotencyKey: (...args: unknown[]) =>
    getCommercialMissionByIdempotencyKey(...args),
}));

import { verifyDemoTenant } from "./demoTenantVerify";

function fakeDb(options: {
  allTablesPresent: boolean;
  tenantRow?: { id: string; status: string } | undefined;
  churnOrderExists?: boolean;
}) {
  return {
    // The verify module calls db.execute once per REQUIRED_TABLES entry, in
    // order, purely to check existence -- a single present/absent toggle is
    // enough for these tests since they don't need per-table granularity.
    execute: vi.fn(async () => [{ count: options.allTablesPresent ? 1 : 0 }]),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () =>
            options.tenantRow
              ? [options.tenantRow]
              : options.churnOrderExists !== undefined
                ? options.churnOrderExists
                  ? [{ id: 1 }]
                  : []
                : []
          ),
        })),
      })),
    })),
  };
}

describe("verifyDemoTenant", () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getCommercialMissionByIdempotencyKey.mockReset();
  });

  it("fails clearly with a database_connection check when there is no database", async () => {
    getDbMock.mockResolvedValue(null);
    const report = await verifyDemoTenant();
    expect(report.ok).toBe(false);
    expect(report.checks).toEqual([
      expect.objectContaining({ name: "database_connection", pass: false }),
    ]);
  });

  it("fails on missing required tables before checking any tenant data", async () => {
    getDbMock.mockResolvedValue(fakeDb({ allTablesPresent: false }));
    const report = await verifyDemoTenant();
    expect(report.ok).toBe(false);
    const failedTableChecks = report.checks.filter(
      check => check.name.startsWith("table:") && !check.pass
    );
    expect(failedTableChecks.length).toBeGreaterThan(0);
    for (const check of failedTableChecks) {
      expect(check.detail).toMatch(/migrations/i);
    }
    // Never gets far enough to check tenant/mission/churn rows.
    expect(report.checks.some(check => check.name === "demo_tenant_exists")).toBe(
      false
    );
  });

  it("fails clearly when the demo tenant row itself is missing", async () => {
    getDbMock.mockResolvedValue(
      fakeDb({ allTablesPresent: true, tenantRow: undefined })
    );
    const report = await verifyDemoTenant();
    expect(report.ok).toBe(false);
    const tenantCheck = report.checks.find(
      check => check.name === "demo_tenant_exists"
    );
    expect(tenantCheck).toEqual(
      expect.objectContaining({ pass: false, detail: expect.stringContaining("Expected tenant") })
    );
  });
});
