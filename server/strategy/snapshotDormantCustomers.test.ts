import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AdminCustomerAggregateDbRow } from "../adminCustomerAggregate";
import { computeCustomerGroupKey } from "../adminCustomerAggregate";
import {
  DORMANT_INACTIVITY_DAYS,
  deriveDormantEligibleCustomers,
  strategyCustomerSnapshotId,
} from "./snapshotDormantCustomers";

const NOW = new Date("2026-09-16T12:00:00.000Z");

function row(
  overrides: Partial<AdminCustomerAggregateDbRow> &
    Pick<AdminCustomerAggregateDbRow, "phone" | "firstName" | "lastOrderAt">
): AdminCustomerAggregateDbRow {
  return {
    lastName: "Test",
    email: null,
    unit: null,
    address: "3545 Wilshire Blvd",
    buildingSlug: "opusla",
    totalOrders: 2,
    lifetimeSpend: 80,
    paidOrderCount: 2,
    firstOrderAt: new Date("2026-01-01T12:00:00.000Z"),
    lastOrderId: 1,
    ordersLast30Days: 0,
    ordersLast90Days: 1,
    ...overrides,
  };
}

describe("deriveDormantEligibleCustomers", () => {
  it("includes paid customers whose last order is at least 30 days before now", () => {
    const dormant = row({
      phone: "3105550101",
      firstName: "Priya",
      lastOrderAt: new Date("2026-07-01T12:00:00.000Z"),
    });
    const active = row({
      phone: "3105550102",
      firstName: "Recent",
      lastOrderAt: new Date("2026-09-10T12:00:00.000Z"),
      paidOrderCount: 1,
    });
    const unpaid = row({
      phone: "3105550103",
      firstName: "Unpaid",
      lastOrderAt: new Date("2026-01-01T12:00:00.000Z"),
      paidOrderCount: 0,
    });

    const result = deriveDormantEligibleCustomers([dormant, active, unpaid], {
      tenantId: "tenant_a",
      now: NOW,
    });

    expect(DORMANT_INACTIVITY_DAYS).toBe(30);
    expect(result.consideredPaidCustomerCount).toBe(2);
    expect(result.totalEligibleCount).toBe(1);
    expect(result.customers).toHaveLength(1);
    expect(result.customers[0]?.firstName).toBe("Priya");
    expect(result.customers[0]?.buildingName).toBe("Opus Los Angeles");
    expect(result.customers[0]?.daysSinceLastOrder).toBe(77);
    expect(result.customers[0]?.id).toBe(
      strategyCustomerSnapshotId("tenant_a", dormant)
    );
  });

  it("does not put a raw phone number on the snapshot identity", () => {
    const dormant = row({
      phone: "3105559999",
      firstName: "Hashed",
      lastOrderAt: new Date("2026-06-01T12:00:00.000Z"),
    });
    const result = deriveDormantEligibleCustomers([dormant], {
      tenantId: "tenant_a",
      now: NOW,
    });
    const serialized = JSON.stringify(result.customers);
    expect(serialized).not.toContain("3105559999");
    expect(result.customers[0]?.id.startsWith("cust_")).toBe(true);
    const expected = createHash("sha256")
      .update(`strategy-customer:tenant_a:${computeCustomerGroupKey(dormant)}`)
      .digest("hex")
      .slice(0, 20);
    expect(result.customers[0]?.id).toBe(`cust_${expected}`);
  });

  it("is tenant-scoped via the hashed id, not a shared customer key", () => {
    const samePerson = row({
      phone: "3105550101",
      firstName: "Priya",
      lastOrderAt: new Date("2026-06-01T12:00:00.000Z"),
    });
    const a = deriveDormantEligibleCustomers([samePerson], {
      tenantId: "tenant_a",
      now: NOW,
    });
    const b = deriveDormantEligibleCustomers([samePerson], {
      tenantId: "tenant_b",
      now: NOW,
    });
    expect(a.customers[0]?.id).not.toBe(b.customers[0]?.id);
  });

  it("uses the supplied now rather than Date.now", () => {
    const dormant = row({
      phone: "3105550101",
      firstName: "Priya",
      lastOrderAt: new Date("2026-09-01T12:00:00.000Z"),
    });
    const early = deriveDormantEligibleCustomers([dormant], {
      tenantId: "t",
      now: new Date("2026-09-10T12:00:00.000Z"),
    });
    const late = deriveDormantEligibleCustomers([dormant], {
      tenantId: "t",
      now: new Date("2026-10-15T12:00:00.000Z"),
    });
    expect(early.customers).toHaveLength(0);
    expect(late.customers).toHaveLength(1);
    expect(late.customers[0]?.daysSinceLastOrder).toBe(44);
  });

  it("does not emit the Slice 2 fixture names", () => {
    const result = deriveDormantEligibleCustomers([], {
      tenantId: "t",
      now: NOW,
    });
    expect(JSON.stringify(result)).not.toMatch(/David|Sarah/);
  });
});
