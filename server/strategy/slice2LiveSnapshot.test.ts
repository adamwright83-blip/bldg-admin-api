import { beforeEach, describe, expect, it } from "vitest";
import type { AdminCustomerAggregateDbRow } from "../adminCustomerAggregate";
import {
  ACCOUNTS_STATE_UNMAPPED_ISSUE,
  _clearSnapshotStore,
  buildStrategySnapshot,
} from "./snapshotBuilder";

const NOW = new Date("2026-09-16T12:00:00.000Z");

function agg(
  overrides: Partial<AdminCustomerAggregateDbRow> &
    Pick<AdminCustomerAggregateDbRow, "phone" | "firstName" | "lastOrderAt">
): AdminCustomerAggregateDbRow {
  return {
    lastName: "X",
    email: null,
    unit: null,
    address: "3545 Wilshire Blvd",
    buildingSlug: "opusla",
    totalOrders: 1,
    lifetimeSpend: 40,
    paidOrderCount: 1,
    firstOrderAt: overrides.lastOrderAt,
    lastOrderId: 9,
    ordersLast30Days: 0,
    ordersLast90Days: 1,
    ...overrides,
  };
}

describe("Slice 2: Strategy snapshot live-derived sections", () => {
  beforeEach(() => {
    _clearSnapshotStore();
  });

  it("does not emit the fabricated dormant, repeat, funnel, or account fixtures", async () => {
    const snapshot = await buildStrategySnapshot("tenant_slice2_empty", {
      now: NOW,
      customerAggregates: [],
    });
    const { payload } = snapshot;
    const dormantJson = JSON.stringify(payload.customers.dormantEligible);
    const repeatJson = JSON.stringify(payload.repeatPipeline);
    const accountsJson = JSON.stringify(payload.accounts);
    const funnelJson = JSON.stringify(payload.growthPlan.stages);

    expect(dormantJson).not.toMatch(/David|Sarah|Wilshire Vista|Sunset Towers/);
    expect(repeatJson).not.toMatch(/Marcus K\.|Elena R\./);
    expect(accountsJson).not.toMatch(
      /Wilshire Grand Residences|The Century Plaza|Broadway Palace Lofts/
    );
    expect(funnelJson).not.toContain("Property Discovery");
    expect(payload.growthPlan.stages.some(s => s.count === 14)).toBe(false);
    expect(payload.accounts).toEqual([]);
    expect(payload.customers.dormantEligible).toEqual([]);
    expect(payload.repeatPipeline.recentFirstOrderCustomers).toEqual([]);
    expect(payload.growthPlan.limitingStage).toBe("insufficient_data");
    expect(
      payload.unresolved.some(u => u.issue === ACCOUNTS_STATE_UNMAPPED_ISSUE)
    ).toBe(true);
    expect(snapshot.provenance["customers.dormantEligible"]).toBeDefined();
    expect(snapshot.provenance["accounts"]?.source).toBe("omitted");
  });

  it("derives dormant and repeat lists from injected tenant aggregates", async () => {
    const dormantRow = agg({
      phone: "3105552001",
      firstName: "Priya",
      lastOrderAt: new Date("2026-06-01T12:00:00.000Z"),
      firstOrderAt: new Date("2026-01-01T12:00:00.000Z"),
      paidOrderCount: 2,
      totalOrders: 2,
    });
    const recentFirst = agg({
      phone: "3105552002",
      firstName: "Amina",
      lastOrderAt: new Date("2026-09-10T12:00:00.000Z"),
      firstOrderAt: new Date("2026-09-10T12:00:00.000Z"),
      paidOrderCount: 1,
    });

    const snapshot = await buildStrategySnapshot("tenant_slice2_a", {
      now: NOW,
      customerAggregates: [dormantRow, recentFirst],
    });

    expect(snapshot.payload.customers.dormantEligible.map(c => c.firstName)).toEqual([
      "Priya",
    ]);
    expect(
      snapshot.payload.repeatPipeline.recentFirstOrderCustomers.map(
        c => c.displayName
      )
    ).toEqual(["Amina"]);
    expect(snapshot.payload.growthPlan.stages[0]?.count).toBe(2);
    expect(snapshot.payload.growthPlan.limitingStage).toBe("Resident First Order");
    expect(JSON.stringify(snapshot.payload.customers.dormantEligible)).not.toContain(
      "3105552001"
    );
  });

  it("keeps tenant aggregates isolated when two snapshots are built", async () => {
    const a = await buildStrategySnapshot("tenant_a", {
      now: NOW,
      customerAggregates: [
        agg({
          phone: "3105553001",
          firstName: "TenantAOnly",
          lastOrderAt: new Date("2026-05-01T12:00:00.000Z"),
        }),
      ],
    });
    const b = await buildStrategySnapshot("tenant_b", {
      now: NOW,
      customerAggregates: [
        agg({
          phone: "3105553002",
          firstName: "TenantBOnly",
          lastOrderAt: new Date("2026-05-01T12:00:00.000Z"),
        }),
      ],
    });
    expect(a.payload.customers.dormantEligible[0]?.firstName).toBe("TenantAOnly");
    expect(b.payload.customers.dormantEligible[0]?.firstName).toBe("TenantBOnly");
    expect(a.payload.customers.dormantEligible[0]?.id).not.toBe(
      b.payload.customers.dormantEligible[0]?.id
    );
  });
});
