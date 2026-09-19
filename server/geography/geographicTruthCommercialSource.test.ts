import { describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";

vi.mock("../db", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../db";
import { getGeographicTruth } from "./geographicTruthService";

function thenableRows<T>(rows: T[]) {
  const promise = Promise.resolve(rows);
  const chain = {
    where: () => chain,
    innerJoin: () => chain,
    orderBy: () => chain,
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  return chain;
}

describe("geographic truth commercial CRM source", () => {
  it("keeps native customer truth available when commercial tables are missing", async () => {
    const missingCommercial = Object.assign(
      new Error(
        "Table 'goldline_migrate_check.commercial_account_locations' doesn't exist"
      ),
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
        total: "40.00",
      },
    ];
    vi.mocked(getDb).mockResolvedValue({
      select: () => ({
        from: (table: Parameters<typeof getTableName>[0]) => {
          const name = getTableName(table);
          if (name.startsWith("commercial_")) throw missingCommercial;
          if (name === "entity_locations") return thenableRows([]);
          if (name === "orders") return thenableRows(nativeRows);
          if (name === "cleancloud_paid_orders") return thenableRows([]);
          throw new Error(`unexpected table ${name}`);
        },
      }),
      insert: () => ({
        values: () => ({
          onDuplicateKeyUpdate: async () => undefined,
        }),
      }),
    } as never);

    const truth = await getGeographicTruth({
      tenantId: "t-missing-commercial",
      now: new Date("2026-09-16T12:00:00.000Z"),
    });
    expect(truth.customers).toHaveLength(1);
    expect(truth.customers[0]?.displayName).toBe("LiveAmina Live");
    expect(truth.pursued).toEqual([]);
  });

  it("does not swallow a commercial query error that is not a missing table", async () => {
    const deadlock = Object.assign(new Error("deadlock"), {
      code: "ER_LOCK_DEADLOCK",
      errno: 1213,
    });
    vi.mocked(getDb).mockResolvedValue({
      select: () => ({
        from: (table: Parameters<typeof getTableName>[0]) => {
          const name = getTableName(table);
          if (name.startsWith("commercial_")) throw deadlock;
          if (name === "entity_locations") return thenableRows([]);
          if (name === "orders") return thenableRows([]);
          if (name === "cleancloud_paid_orders") return thenableRows([]);
          throw new Error(`unexpected table ${name}`);
        },
      }),
      insert: () => ({
        values: () => ({
          onDuplicateKeyUpdate: async () => undefined,
        }),
      }),
    } as never);

    await expect(
      getGeographicTruth({ tenantId: "t-deadlock-commercial" })
    ).rejects.toBe(deadlock);
  });
});
