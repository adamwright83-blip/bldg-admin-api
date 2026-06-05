import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("resident intake duplicate guard", () => {
  it("checks for likely duplicate open resident orders before inserting", () => {
    const source = readFileSync(new URL("./_core/index.ts", import.meta.url), "utf8");

    expect(source).toContain("findLikelyDuplicateOpenResidentOrder(orderValues)");
    expect(source.indexOf("findLikelyDuplicateOpenResidentOrder(orderValues)")).toBeLessThan(source.indexOf("const orderId = await createOrder(orderValues)"));
    expect(source).toContain("duplicate: true");
  });

  it("limits duplicate matching to open resident/intake rows with same schedule and request signal", () => {
    const source = readFileSync(new URL("./db.ts", import.meta.url), "utf8");

    expect(source).toContain("OPEN_ORDER_STATUSES");
    expect(source).toContain("findLikelyDuplicateOpenResidentOrder");
    expect(source).toContain("eq(orders.serviceType, order.serviceType)");
    expect(source).toContain("eq(orders.pickupDate, order.pickupDate)");
    expect(source).toContain("duplicateRequestSignal");
    expect(source).toContain("sameDuplicateResident");
  });
});
