import { describe, expect, it } from "vitest";
import {
  ACTIVE_CUSTOMER_DEFINITION,
} from "../claire/activeCustomerMetric";
import {
  getStrategyActiveCustomers,
  getStrategyGrowthMetrics,
} from "./growthMetrics";
import type { PaidOrderEvent } from "../analytics/paidOrderLedger";

function mockEvent(overrides: Partial<PaidOrderEvent>): PaidOrderEvent {
  const businessDate = overrides.businessDate ?? "2026-09-01";
  return {
    source: "cleancloud",
    eventKey: `test-${Math.random()}`,
    occurredAt: new Date(`${businessDate}T12:00:00.000Z`),
    businessDate,
    cents: 5000,
    serviceType: "wash_fold",
    customerName: "Test Customer",
    identity: {
      phone: "3105551234",
      email: "test@example.com",
    },
    ...overrides,
  };
}

describe("Slice 2: Growth Metrics", () => {
  it("uses the canonical active customer definition string", async () => {
    const res = await getStrategyActiveCustomers(
      { tenantId: "tenant-test" },
      {
        laundry_butler: async () => [],
        cleancloud: async () => [],
      }
    );
    expect(res.definition).toBe(ACTIVE_CUSTOMER_DEFINITION);
    expect(res.provenance.queryOrDefinition).toBe(ACTIVE_CUSTOMER_DEFINITION);
  });

  it("trend weeks use business-local boundaries and length 8", async () => {
    const res = await getStrategyActiveCustomers(
      { tenantId: "tenant-test", timeZone: "America/Los_Angeles" },
      {
        laundry_butler: async () => [],
        cleancloud: async () => [],
      }
    );
    expect(res.trend).toHaveLength(8);
    expect(res.trend[7]?.weekIndex).toBe(7);
  });

  describe("guardrail.G12.duplicate_identity_counts_once", () => {
    it("counts two orders sharing phone or email as one new paying customer", async () => {
      const e1 = mockEvent({
        eventKey: "e1",
        businessDate: "2026-09-05",
        identity: { phone: "3105550001", email: "alice@example.com" },
      });
      const e2 = mockEvent({
        eventKey: "e2",
        businessDate: "2026-09-10",
        identity: { phone: "3105550001", email: null }, // same phone, missing email
      });

      const res = await getStrategyGrowthMetrics({
        tenantId: "tenant-test",
        period: { startYmd: "2026-09-01", endYmd: "2026-09-30" },
        mockEvents: [e1, e2],
      });

      expect(res.newPayingCustomers.count).toBe(1);
      expect(res.paidOrders.count).toBe(2);
    });
  });

  describe("guardrail.G12.reactivation_not_new", () => {
    it("classifies returning dormant customer as reactivated, never new", async () => {
      // Historical first order in July
      const historical = mockEvent({
        eventKey: "hist-1",
        businessDate: "2026-07-01",
        occurredAt: new Date("2026-07-01T12:00:00Z"),
        identity: { phone: "3105550002" },
      });
      // Second order in September after 70-day gap
      const returning = mockEvent({
        eventKey: "ret-1",
        businessDate: "2026-09-10",
        occurredAt: new Date("2026-09-10T12:00:00Z"),
        identity: { phone: "3105550002" },
      });

      const res = await getStrategyGrowthMetrics({
        tenantId: "tenant-test",
        period: { startYmd: "2026-09-01", endYmd: "2026-09-30" },
        inactivityDays: 30,
        mockEvents: [historical, returning],
      });

      expect(res.newPayingCustomers.count).toBe(0);
      expect(res.reactivatedCustomers.count).toBe(1);
    });
  });

  describe("guardrail.G12.incomplete_history_is_uncertain", () => {
    it("places customers with unverified/incomplete history into uncertain bucket", async () => {
      const e = mockEvent({
        eventKey: "unverified-1",
        businessDate: "2026-09-05",
        identity: { phone: "3105550099" },
      });

      // Mark this customer group as uncertain
      const res = await getStrategyGrowthMetrics({
        tenantId: "tenant-test",
        period: { startYmd: "2026-09-01", endYmd: "2026-09-30" },
        mockEvents: [e],
        unverifiedCustomers: new Set(["phone:3105550099"]),
      });

      expect(res.newPayingCustomers.count).toBe(0);
      expect(res.newPayingCustomers.uncertainCount).toBe(1);
      expect(res.newPayingCustomers.uncertainReasons[0]?.reason).toContain("unverified or incomplete");
    });
  });

  it("marks netSales as uncertain because canonical accounting does not deduct refunds", async () => {
    const e = mockEvent({
      businessDate: "2026-09-12",
      cents: 7500,
    });
    const res = await getStrategyGrowthMetrics({
      tenantId: "tenant-test",
      period: { startYmd: "2026-09-01", endYmd: "2026-09-30" },
      mockEvents: [e],
    });

    expect(res.netSales.amountCents).toBe(7500);
    expect(res.netSales.isUncertain).toBe(true);
    expect(res.netSales.uncertaintyReason).toContain("does not record refunds");
  });

  it("first and second paid orders land in the correct repeat conversion cohort", async () => {
    // Customer 1: first order in Sept, second order in Sept
    const c1_o1 = mockEvent({
      eventKey: "c1-1",
      businessDate: "2026-09-02",
      occurredAt: new Date("2026-09-02T10:00:00Z"),
      identity: { phone: "3105551111" },
    });
    const c1_o2 = mockEvent({
      eventKey: "c1-2",
      businessDate: "2026-09-15",
      occurredAt: new Date("2026-09-15T10:00:00Z"),
      identity: { phone: "3105551111" },
    });

    // Customer 2: first order in Sept, no repeat
    const c2_o1 = mockEvent({
      eventKey: "c2-1",
      businessDate: "2026-09-05",
      occurredAt: new Date("2026-09-05T10:00:00Z"),
      identity: { phone: "3105552222" },
    });

    const res = await getStrategyGrowthMetrics({
      tenantId: "tenant-test",
      period: { startYmd: "2026-09-01", endYmd: "2026-09-30" },
      mockEvents: [c1_o1, c1_o2, c2_o1],
    });

    expect(res.repeatConversion.cohortSize).toBe(2);
    expect(res.repeatConversion.repeatCount).toBe(1);
    expect(res.repeatConversion.conversionRate).toBe(0.5);
  });

  it("preserves tenant isolation", async () => {
    const t1Order = mockEvent({
      businessDate: "2026-09-05",
      identity: { phone: "3105553333" },
    });

    const resT1 = await getStrategyGrowthMetrics({
      tenantId: "tenant-1",
      period: { startYmd: "2026-09-01", endYmd: "2026-09-30" },
      mockEvents: [t1Order],
    });

    const resT2 = await getStrategyGrowthMetrics({
      tenantId: "tenant-2",
      period: { startYmd: "2026-09-01", endYmd: "2026-09-30" },
      mockEvents: [], // tenant 2 has 0 events
    });

    expect(resT1.newPayingCustomers.count).toBe(1);
    expect(resT2.newPayingCustomers.count).toBe(0);
  });
});
