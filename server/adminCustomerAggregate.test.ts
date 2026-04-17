import { describe, expect, it } from "vitest";
import {
  buildAdminCustomerAggregatesInMemory,
  normalizeOrderRowFromDb,
} from "./adminCustomerAggregate";

const base = {
  email: null as string | null,
  unit: null as string | null,
  paid: false,
  total: "0" as string | null,
};

describe("buildAdminCustomerAggregatesInMemory", () => {
  it("uses older rich row for display when newest row is junk", () => {
    const rows = [
      {
        id: 1,
        phone: "+15550001",
        firstName: "Bailey",
        lastName: "Smith",
        ...base,
        unit: "1205",
        address: "3545 wilshire blvd, los angeles, ca",
        buildingSlug: "opusla",
        createdAt: new Date("2025-01-01T12:00:00Z"),
      },
      {
        id: 2,
        phone: "+15550001",
        firstName: "",
        lastName: "",
        ...base,
        unit: null,
        address: "",
        buildingSlug: null,
        createdAt: new Date("2026-03-01T12:00:00Z"),
      },
    ];

    const [agg] = buildAdminCustomerAggregatesInMemory(rows);
    expect(agg.firstName).toBe("Bailey");
    expect(agg.lastName).toBe("Smith");
    expect(agg.unit).toBe("1205");
    expect(agg.address).toContain("3545");
    expect(agg.buildingSlug).toBe("3545");
    expect(agg.lastOrderId).toBe(2);
    expect(agg.totalOrders).toBe(2);
    expect(agg.lastOrderAt.getTime()).toBe(new Date("2026-03-01T12:00:00Z").getTime());
  });

  it("merges name from one order and address from another on same phone", () => {
    const rows = [
      {
        id: 1,
        phone: "+13105550100",
        firstName: "Alex",
        lastName: "Rivera",
        ...base,
        unit: null,
        address: "",
        buildingSlug: null,
        createdAt: new Date("2025-02-01T12:00:00Z"),
      },
      {
        id: 2,
        phone: "+13105550100",
        firstName: "",
        lastName: "",
        ...base,
        unit: null,
        address: "3545 wilshire blvd, los angeles, ca",
        buildingSlug: null,
        createdAt: new Date("2026-01-15T12:00:00Z"),
      },
    ];
    const [agg] = buildAdminCustomerAggregatesInMemory(rows);
    expect(agg.firstName).toBe("Alex");
    expect(agg.lastName).toBe("Rivera");
    expect(agg.address).toContain("3545");
    expect(agg.buildingSlug).toBe("3545");
    expect(agg.lastOrderId).toBe(2);
  });

  it("normalizeOrderRowFromDb treats mysql paid=1 as paid", () => {
    const [agg] = buildAdminCustomerAggregatesInMemory([
      normalizeOrderRowFromDb({
        id: 1,
        phone: "+12025550100",
        firstName: "Pay",
        lastName: "Check",
        email: null,
        unit: "1",
        address: "3545 wilshire blvd",
        buildingSlug: null,
        createdAt: new Date("2026-01-01T12:00:00Z"),
        paid: 1,
        total: "50.00",
      }),
    ]);
    expect(agg.lifetimeSpend).toBe(50);
    expect(agg.paidOrderCount).toBe(1);
  });

  it("falls back to latest when all rows are empty tier", () => {
    const rows = [
      {
        id: 10,
        phone: "+1999",
        firstName: "",
        lastName: "",
        ...base,
        unit: null,
        address: "",
        buildingSlug: null,
        createdAt: new Date("2025-06-01T00:00:00Z"),
      },
      {
        id: 11,
        phone: "+1999",
        firstName: "",
        lastName: "",
        ...base,
        unit: null,
        address: "",
        buildingSlug: null,
        createdAt: new Date("2025-07-01T00:00:00Z"),
      },
    ];
    const [agg] = buildAdminCustomerAggregatesInMemory(rows);
    expect(agg.lastOrderId).toBe(11);
    expect(agg.firstName).toBe("");
  });
});
