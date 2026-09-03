import { describe, expect, it } from "vitest";
import {
  COAST_CLEANER_SLUG,
  PARAGON_CLEANER_SLUG,
  PARAGON_DEFAULT_PARTNER_DISCOUNT_PCT,
  cleanerCostCents,
  computeDryCleanEconomics,
  dryCleanLineKey,
  parseDryCleanLineKey,
} from "./dryCleaners";

describe("dry-clean line keys", () => {
  it("keeps COAST lines on the legacy bare slug so old orders still parse", () => {
    expect(dryCleanLineKey(COAST_CLEANER_SLUG, "dress")).toBe("dress");
    expect(parseDryCleanLineKey("dress")).toEqual({
      cleanerSlug: COAST_CLEANER_SLUG,
      itemSlug: "dress",
    });
  });

  it("namespaces every other cleaner so one order can hold both", () => {
    const key = dryCleanLineKey(PARAGON_CLEANER_SLUG, "dress");
    expect(key).toBe("paragon::dress");
    expect(parseDryCleanLineKey(key)).toEqual({
      cleanerSlug: PARAGON_CLEANER_SLUG,
      itemSlug: "dress",
    });
  });
});

describe("Carol's PARAGON CLEANERS dress", () => {
  /* The one real Paragon transaction we have: full retail, no discount. */
  const econ = computeDryCleanEconomics({
    cleanerRetailPriceCents: 1479,
    partnerDiscountPct: 0,
    customerPriceCents: 1900,
  });

  it("costs what Paragon actually charged", () => {
    expect(econ.actualCleanerCostCents).toBe(1479);
  });

  it("derives $4.21 profit", () => {
    expect(econ.grossProfitCents).toBe(421);
  });

  it("derives roughly 22.2% gross margin", () => {
    expect(econ.grossMarginPct).toBeCloseTo(22.2, 1);
  });
});

describe("partnership discounts are defaults, never rules", () => {
  it("applies PARAGON's normal 15% when it is actually received", () => {
    const econ = computeDryCleanEconomics({
      cleanerRetailPriceCents: 2000,
      partnerDiscountPct: PARAGON_DEFAULT_PARTNER_DISCOUNT_PCT,
      customerPriceCents: 2500,
    });
    expect(econ.actualCleanerCostCents).toBe(1700);
    expect(econ.grossProfitCents).toBe(800);
    expect(econ.grossMarginPct).toBeCloseTo(32, 1);
  });

  it("records an override down to 0% instead of assuming the default", () => {
    expect(cleanerCostCents(2000, 0)).toBe(2000);
    expect(cleanerCostCents(2000, PARAGON_DEFAULT_PARTNER_DISCOUNT_PCT)).toBe(
      1700
    );
  });

  it("never assumes a margin: the same cost yields different margins", () => {
    const cheap = computeDryCleanEconomics({
      cleanerRetailPriceCents: 1479,
      partnerDiscountPct: 0,
      customerPriceCents: 1900,
    });
    const dearer = computeDryCleanEconomics({
      cleanerRetailPriceCents: 1479,
      partnerDiscountPct: 0,
      customerPriceCents: 3000,
    });
    expect(cheap.grossMarginPct).not.toBeCloseTo(dearer.grossMarginPct ?? 0, 1);
  });

  it("reports no margin rather than a fake one when there is no revenue", () => {
    expect(
      computeDryCleanEconomics({
        cleanerRetailPriceCents: 1000,
        partnerDiscountPct: 0,
        customerPriceCents: 0,
      }).grossMarginPct
    ).toBeNull();
  });
});
