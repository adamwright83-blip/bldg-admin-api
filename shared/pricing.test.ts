import { describe, expect, it } from "vitest";
import {
  DC_ITEMS,
  DRY_CLEAN_PARTNER_DISCOUNT_PERCENT,
  dryCleanCostCentsFromRetail,
} from "./pricing";

describe("dry-clean partner cost basis", () => {
  it("uses a 40% partner discount, i.e. cost is 60% of retail", () => {
    expect(DRY_CLEAN_PARTNER_DISCOUNT_PERCENT).toBe(40);
  });

  it("computes cost as 60% of retail, not 50%", () => {
    expect(dryCleanCostCentsFromRetail(1800)).toBe(1080);
    expect(dryCleanCostCentsFromRetail(1800)).not.toBe(900);
  });
});

describe("Long Dress catalog item", () => {
  const longDress = DC_ITEMS.find(i => i.id === "long_dress");

  it("exists under Dresses at $18.00 retail", () => {
    expect(longDress).toBeDefined();
    expect(longDress?.category).toBe("Dresses");
    expect(longDress?.label).toBe("Long Dress");
    expect(longDress?.priceCents).toBe(1800);
  });

  it("seeds to a $10.80 cost (60% of retail) via the shared helper", () => {
    expect(dryCleanCostCentsFromRetail(longDress!.priceCents)).toBe(1080);
  });
});
