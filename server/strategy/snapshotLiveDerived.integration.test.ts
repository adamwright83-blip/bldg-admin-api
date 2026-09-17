import { describe, expect, it } from "vitest";
import { orders } from "../../drizzle/schema";
import { getDb } from "../db";
import { _clearSnapshotStore, buildStrategySnapshot } from "./snapshotBuilder";

/**
 * Real-MySQL coverage for Slice 2 StrategyEngine sections.
 * Requires DATABASE_URL. Excluded from default `pnpm test`.
 */

async function insertPaidOrder(input: {
  tenantId: string;
  phone: string;
  firstName: string;
  createdAt: Date;
  paid?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(orders).values({
    tenantId: input.tenantId,
    serviceType: "wash_fold",
    pickupDate: "2026-01-16",
    pickupTimeWindow: "9am-11am",
    address: "3545 Wilshire Blvd, Los Angeles, CA 90010",
    firstName: input.firstName,
    lastName: "Live",
    phone: input.phone,
    status: "delivered",
    subtotal: "40.00",
    total: "40.00",
    paid: input.paid ?? true,
    paidAt: input.createdAt,
    createdAt: input.createdAt,
    buildingSlug: "opusla",
  });
}

describe("Slice 2 strategy snapshot — real MySQL aggregates", () => {
  it("tenant A dormant list does not include tenant B customers or fixture names", async () => {
    _clearSnapshotStore();
    const suffix = `${Date.now()}`;
    const tenantA = `slice2a_${suffix}`;
    const tenantB = `slice2b_${suffix}`;
    const now = new Date("2026-09-16T12:00:00.000Z");
    const fortyFiveDaysAgo = new Date(now.getTime() - 45 * 86_400_000);

    await insertPaidOrder({
      tenantId: tenantA,
      phone: "3105554101",
      firstName: "LiveAmina",
      createdAt: fortyFiveDaysAgo,
    });
    await insertPaidOrder({
      tenantId: tenantB,
      phone: "3105554102",
      firstName: "LiveBo",
      createdAt: fortyFiveDaysAgo,
    });

    const snapA = await buildStrategySnapshot(tenantA, { now });
    const snapB = await buildStrategySnapshot(tenantB, { now });

    expect(snapA.payload.customers.dormantEligible.map(c => c.firstName)).toContain(
      "LiveAmina"
    );
    expect(snapA.payload.customers.dormantEligible.map(c => c.firstName)).not.toContain(
      "LiveBo"
    );
    expect(snapB.payload.customers.dormantEligible.map(c => c.firstName)).toContain(
      "LiveBo"
    );
    expect(JSON.stringify(snapA.payload.customers.dormantEligible)).not.toMatch(
      /David|Sarah|3105554101/
    );
    expect(snapA.payload.accounts).toEqual([]);
    expect(snapA.payload.repeatPipeline.recentFirstOrderCustomers).toEqual([]);
    expect(snapA.payload.growthPlan.stages[0]?.name).toBe("Resident First Order");
    expect(snapA.payload.growthPlan.stages[0]?.count).toBeGreaterThanOrEqual(1);
  }, 20000);
});
