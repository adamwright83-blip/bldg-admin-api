import { describe, expect, it } from "vitest";
import { buildAdminCustomerAggregatesInMemory } from "./adminCustomerAggregate";

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
    expect(agg.buildingSlug).toBe("opusla");
    expect(agg.lastOrderId).toBe(2);
    expect(agg.totalOrders).toBe(2);
    expect(agg.lastOrderAt.getTime()).toBe(new Date("2026-03-01T12:00:00Z").getTime());
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
