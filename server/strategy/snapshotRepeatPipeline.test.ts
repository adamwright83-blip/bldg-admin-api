import { describe, expect, it } from "vitest";
import type { AdminCustomerAggregateDbRow } from "../adminCustomerAggregate";
import { deriveRepeatPipeline } from "./snapshotRepeatPipeline";
import { deriveFunnelFromCustomerAggregates } from "./snapshotFunnel";

const NOW = new Date("2026-09-16T12:00:00.000Z");

function row(
  overrides: Partial<AdminCustomerAggregateDbRow> &
    Pick<AdminCustomerAggregateDbRow, "phone" | "firstName" | "firstOrderAt">
): AdminCustomerAggregateDbRow {
  return {
    lastName: "Test",
    email: null,
    unit: null,
    address: "",
    buildingSlug: null,
    totalOrders: 1,
    lifetimeSpend: 40,
    paidOrderCount: 1,
    lastOrderAt: overrides.firstOrderAt,
    lastOrderId: 1,
    ordersLast30Days: 1,
    ordersLast90Days: 1,
    ...overrides,
  };
}

describe("deriveRepeatPipeline", () => {
  it("includes recent first paid orders and does not invent fulfillment or feedback", () => {
    const firstOnly = row({
      phone: "3105551001",
      firstName: "Amina",
      firstOrderAt: new Date("2026-09-08T12:00:00.000Z"),
      paidOrderCount: 1,
    });
    const converted = row({
      phone: "3105551002",
      firstName: "Bo",
      firstOrderAt: new Date("2026-09-10T12:00:00.000Z"),
      lastOrderAt: new Date("2026-09-14T12:00:00.000Z"),
      paidOrderCount: 2,
      totalOrders: 2,
    });
    const old = row({
      phone: "3105551003",
      firstName: "Old",
      firstOrderAt: new Date("2026-01-01T12:00:00.000Z"),
      lastOrderAt: new Date("2026-01-01T12:00:00.000Z"),
      paidOrderCount: 1,
    });

    const result = deriveRepeatPipeline([firstOnly, converted, old], {
      tenantId: "t1",
      now: NOW,
    });

    expect(result.summary.totalRecent).toBe(2);
    expect(result.summary.openFeedbackIssues).toBeNull();
    expect(result.summary.secondOrdersPlaced).toBe(1);
    expect(result.recentFirstOrderCustomers.map(c => c.displayName).sort()).toEqual(
      ["Amina", "Bo"]
    );
    expect(
      result.recentFirstOrderCustomers.every(
        c =>
          c.fulfillmentStatus === "unavailable" &&
          c.feedbackStatus === "unavailable"
      )
    ).toBe(true);
    expect(
      result.recentFirstOrderCustomers.find(c => c.displayName === "Amina")
        ?.hasSecondOrder
    ).toBe(false);
    expect(
      result.recentFirstOrderCustomers.find(c => c.displayName === "Bo")
        ?.hasSecondOrder
    ).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/Marcus K\.|Elena R\./);
  });

  it("does not mark first-order customers due to reorder without observed cadence", () => {
    const firstOnly = row({
      phone: "3105551001",
      firstName: "Amina",
      firstOrderAt: new Date("2026-09-01T12:00:00.000Z"),
    });
    const result = deriveRepeatPipeline([firstOnly], {
      tenantId: "t1",
      now: NOW,
    });
    expect(result.recentFirstOrderCustomers[0]?.isDueToReorder).toBe(false);
    expect(result.recentFirstOrderCustomers[0]?.reorderBasis).toBe(
      "insufficient_history_for_observed_cadence"
    );
  });
});

describe("deriveFunnelFromCustomerAggregates", () => {
  it("counts observed first and repeat paid customers without fabricated discovery stages", () => {
    const rows = [
      row({
        phone: "1",
        firstName: "A",
        firstOrderAt: NOW,
        paidOrderCount: 1,
      }),
      row({
        phone: "2",
        firstName: "B",
        firstOrderAt: NOW,
        paidOrderCount: 3,
        totalOrders: 3,
      }),
      row({
        phone: "3",
        firstName: "C",
        firstOrderAt: NOW,
        paidOrderCount: 0,
      }),
    ];
    const { stages, limitingStage } = deriveFunnelFromCustomerAggregates(rows);
    expect(stages.map(s => s.name)).toEqual([
      "Resident First Order",
      "Resident Repeat Order",
    ]);
    expect(stages[0]?.count).toBe(2);
    expect(stages[1]?.count).toBe(1);
    expect(stages[0]?.observedConversionRate).toBe(0.5);
    expect(stages.every(s => s.isScenario === false)).toBe(true);
    expect(limitingStage).toBe("Resident First Order");
    expect(JSON.stringify(stages)).not.toContain("Property Discovery");
  });

  it("reports insufficient_data when there are no paid customers", () => {
    const { stages, limitingStage } = deriveFunnelFromCustomerAggregates([]);
    expect(stages).toEqual([]);
    expect(limitingStage).toBe("insufficient_data");
  });
});
