import { describe, expect, it } from "vitest";
import type { PaidOrderEvent } from "../analytics/paidOrderLedger";
import { getStrategyActiveCustomers, getStrategyGrowthMetrics } from "./growthMetrics";

const period = { startYmd: "2026-09-01", endYmd: "2026-09-30" };
const now = new Date("2026-09-30T12:00:00Z");
function event(key: string, date: string, cents: number): PaidOrderEvent {
  return { source: "cleancloud", eventKey: key, occurredAt: new Date(`${date}T12:00:00Z`), businessDate: date,
    cents, customerName: "A", identity: { phone: "3105551234" }, serviceType: "wash_fold" };
}
const unavailable = { laundry_butler: async () => { throw new Error("unavailable"); },
  cleancloud: async () => { throw new Error("unavailable"); } };

describe("strategy economic authority", () => {
  it("does not count a refund or zero adjustment as another purchase", async () => {
    const result = await getStrategyGrowthMetrics({ tenantId: "t", period, now,
      mockEvents: [event("sale", "2026-09-02", 5000), event("refund", "2026-09-12", -5000), event("adjustment", "2026-09-15", 0)] });
    expect(result.repeatConversion.repeatCount).toBe(0);
    expect(result.reactivatedCustomers.count).toBe(0);
  });
  it("keeps unavailable active and growth metrics missing", async () => {
    const active = await getStrategyActiveCustomers({ tenantId: "t", now }, unavailable);
    expect(active.count).toBeNull();
    const growth = await getStrategyGrowthMetrics({ tenantId: "t", period, now }, unavailable);
    expect(growth.newPayingCustomers.count).toBeNull();
    expect(growth.paidOrders.count).toBeNull();
    expect(growth.netSales.amountCents).toBeNull();
    expect(growth.repeatConversion.conversionRate).toBeNull();
    expect(growth.netActiveChange.change).toBeNull();
  });
  it("does not certify first-ever purchase when historical coverage is missing", async () => {
    const result = await getStrategyGrowthMetrics({ tenantId: "t", period, now,
      mockEvents: [event("observed-first", "2026-09-02", 5000)], mockHistoryComplete: false });
    expect(result.newPayingCustomers.count).toBeNull();
    expect(result.newPayingCustomers.uncertainCount).toBe(1);
    expect(result.newPayingCustomers.uncertainReasons[0]?.reason).toContain("history");
  });
});
