import { describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";

vi.mock("../db", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../db";
import { loadStrategyCustomerAggregates } from "./snapshotCustomerAggregateLoad";

describe("loadStrategyCustomerAggregates", () => {
  it("returns unavailable when there is no database", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null as never);
    const load = await loadStrategyCustomerAggregates("t1");
    expect(load).toEqual({
      status: "unavailable",
      reason: "Database not available",
    });
  });

  it("returns unavailable for a missing orders table, not an empty observation", async () => {
    const error = Object.assign(new Error("Table 'x.orders' doesn't exist"), {
      code: "ER_NO_SUCH_TABLE",
      errno: 1146,
    });
    vi.mocked(getDb).mockResolvedValue({
      select: () => {
        throw error;
      },
    } as never);
    const load = await loadStrategyCustomerAggregates("t1");
    expect(load.status).toBe("unavailable");
    if (load.status === "unavailable") {
      expect(load.reason).toMatch(/orders table/);
    }
  });

  it("rethrows unexpected SQL errors instead of treating them as empty", async () => {
    const error = Object.assign(new Error("deadlock"), {
      code: "ER_LOCK_DEADLOCK",
      errno: 1213,
    });
    vi.mocked(getDb).mockResolvedValue({
      select: () => {
        throw error;
      },
    } as never);
    await expect(loadStrategyCustomerAggregates("t1")).rejects.toBe(error);
  });

  it("keeps native aggregates available when cleancloud_paid_orders is missing", async () => {
    const missingCleanCloud = Object.assign(
      new Error("Table 'goldline_migrate_check.cleancloud_paid_orders' doesn't exist"),
      { code: "ER_NO_SUCH_TABLE", errno: 1146 }
    );
    const nativeRows = [
      {
        id: 9,
        status: "delivered",
        createdAt: new Date("2026-01-01T12:00:00.000Z"),
        firstName: "LiveAmina",
        lastName: "Live",
        phone: "3105554101",
        email: null,
        address: "3545 Wilshire Blvd, Los Angeles, CA 90010",
        unit: null,
        buildingSlug: "opusla",
        bldgUserId: null,
        paid: true,
        stripePaymentIntentId: "pi_test_live_amanda",
        total: "40.00",
      },
    ];
    vi.mocked(getDb).mockResolvedValue({
      select: () => ({
        from: (table: Parameters<typeof getTableName>[0]) => {
          const name = getTableName(table);
          if (name === "cleancloud_paid_orders") throw missingCleanCloud;
          const rows = Promise.resolve(nativeRows);
          return Object.assign(rows, { where: () => rows });
        },
      }),
    } as never);

    const load = await loadStrategyCustomerAggregates("t1");
    expect(load.status).toBe("available");
    if (load.status === "available") {
      expect(load.rows).toHaveLength(1);
      expect(load.rows[0]?.firstName).toBe("LiveAmina");
      expect(load.rows[0]?.paidOrderCount).toBe(1);
      expect(load.rows[0]?.lifetimeSpend).toBe(40);
      expect(load.rows[0]?.sources).toEqual(["laundry_butler"]);
    }
  });

  it("does not swallow a CleanCloud query error that is not a missing table", async () => {
    const deadlock = Object.assign(new Error("deadlock"), {
      code: "ER_LOCK_DEADLOCK",
      errno: 1213,
    });
    vi.mocked(getDb).mockResolvedValue({
      select: () => ({
        from: (table: Parameters<typeof getTableName>[0]) => {
          if (getTableName(table) === "cleancloud_paid_orders") throw deadlock;
          const rows = Promise.resolve([]);
          return Object.assign(rows, { where: () => rows });
        },
      }),
    } as never);
    await expect(loadStrategyCustomerAggregates("t1")).rejects.toBe(deadlock);
  });
});
