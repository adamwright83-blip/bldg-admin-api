import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../db";
import { _clearSnapshotStore, buildStrategySnapshot } from "./snapshotBuilder";

/**
 * Real-MySQL coverage for Slice 2 StrategyEngine sections.
 * Requires DATABASE_URL. Inserts only columns present on scripts/migrate.mjs
 * `orders` (goldline_migrate_check), not the full drizzle schema.
 */

async function insertPaidOrder(input: {
  tenantId: string;
  phone: string;
  firstName: string;
  createdAt: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const created = input.createdAt.toISOString().slice(0, 19).replace("T", " ");
  await db.execute(sql`
    INSERT INTO orders (
      tenantId, serviceType, pickupDate, pickupTimeWindow, address,
      firstName, lastName, phone, status, paid, stripePaymentIntentId, total, createdAt
    ) VALUES (
      ${input.tenantId},
      'wash_fold',
      '2026-01-16',
      '9am-11am',
      '3545 Wilshire Blvd, Los Angeles, CA 90010',
      ${input.firstName},
      'Live',
      ${input.phone},
      'delivered',
      1,
      ${`pi_test_${input.phone}`},
      '40.00',
      ${created}
    )
  `);
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

    expect(snapA.payload.customers.aggregateSource).toBe("observed");
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
    expect(snapA.payload.repeatPipeline.summary.openFeedbackIssues).toBeNull();
    expect(snapA.payload.growthPlan.stages[0]?.name).toBe("Resident First Order");
    expect(snapA.payload.growthPlan.stages[0]?.count).toBeGreaterThanOrEqual(1);
  }, 20000);
});
