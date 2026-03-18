import { describe, expect, it } from "vitest";
import {
  calcWashFoldTotal,
  calcDryCleanTotal,
  centsToDollars,
  WF_MINIMUM_SUBTOTAL_CENTS,
  type UpchargeEntry,
  type DryCleanEntry,
} from "../shared/pricing";
import { buildReceiptLines } from "../shared/receipt";

describe("buildReceiptLines", () => {
  it("maps dry cleaning items to receipt rows", () => {
    const lines = buildReceiptLines({
      serviceType: "dry_cleaning",
      weightLbs: null,
      upchargesJson: null,
      drycleanItemsJson: {
        pants: {
          label: "Pants",
          unit_price_cents: 1000,
          qty: 2,
          total_cents: 2000,
        },
      },
      subtotal: "20.00",
    });
    expect(lines).toEqual([
      {
        item: "Pants",
        quantity: "2",
        unitPrice: "10.00",
        amount: "20.00",
      },
    ]);
  });

  it("adds minimum adjustment line for wash_fold below subtotal", () => {
    const lines = buildReceiptLines({
      serviceType: "wash_fold",
      weightLbs: "5",
      upchargesJson: {},
      drycleanItemsJson: null,
      subtotal: "45.00",
    });
    expect(lines[0].item).toBe("Wash & Fold");
    expect(lines[0].quantity).toBe("5");
    expect(lines.some((l) => l.item.includes("minimum"))).toBe(true);
  });
});

describe("Pricing: calcWashFoldTotal", () => {
  it("enforces $45 minimum when weight-based total is below", () => {
    // 5 lbs × $2.50 = $12.50, should enforce $45 minimum
    const result = calcWashFoldTotal(5, {}, {}, 0);
    expect(result.subtotalCents).toBe(WF_MINIMUM_SUBTOTAL_CENTS);
    expect(result.totalCents).toBe(WF_MINIMUM_SUBTOTAL_CENTS);
  });

  it("calculates correctly when weight exceeds minimum", () => {
    // 25 lbs × $2.50 = $62.50 → above $45 minimum
    const result = calcWashFoldTotal(25, {}, {}, 0);
    expect(result.subtotalCents).toBe(6250);
    expect(result.totalCents).toBe(6250);
  });

  it("adds upcharges to the base weight cost", () => {
    const upcharges: Record<string, UpchargeEntry> = {
      bleach: { label: "Bleach", unit_price_cents: 200, qty: 1, total_cents: 200 },
      hot_wash: { label: "Hot Wash", unit_price_cents: 75, qty: 1, total_cents: 75 },
    };
    // 25 lbs × $2.50 = $62.50 + $2.00 + $0.75 = $65.25
    const result = calcWashFoldTotal(25, upcharges, {}, 0);
    expect(result.subtotalCents).toBe(6525);
    expect(result.totalCents).toBe(6525);
  });

  it("adds flat-rate textiles to the total", () => {
    const flatRate: Record<string, UpchargeEntry> = {
      comforter_wf: { label: "Comforter", unit_price_cents: 3500, qty: 2, total_cents: 7000 },
    };
    // 5 lbs × $2.50 = $12.50 + $70 = $82.50 → above $45 min
    const result = calcWashFoldTotal(5, {}, flatRate, 0);
    expect(result.subtotalCents).toBe(8250);
    expect(result.totalCents).toBe(8250);
  });

  it("applies discount after minimum enforcement", () => {
    // 5 lbs = $12.50 → enforced to $45 → 20% off = $36
    const result = calcWashFoldTotal(5, {}, {}, 20);
    expect(result.subtotalCents).toBe(WF_MINIMUM_SUBTOTAL_CENTS);
    expect(result.totalCents).toBe(3600);
  });

  it("applies first-order 20% discount correctly", () => {
    // 25 lbs = $62.50 → 20% off = $50.00
    const result = calcWashFoldTotal(25, {}, {}, 20);
    expect(result.subtotalCents).toBe(6250);
    expect(result.totalCents).toBe(5000);
  });
});

describe("Pricing: calcDryCleanTotal", () => {
  it("sums dry cleaning items correctly", () => {
    const items: Record<string, DryCleanEntry> = {
      dress_shirt: { label: "Dress Shirt", category: "Tops", unit_price_cents: 600, qty: 3, total_cents: 1800 },
      pants: { label: "Pants", category: "Pants", unit_price_cents: 1000, qty: 2, total_cents: 2000 },
    };
    // 3 × $6 + 2 × $10 = $38
    const result = calcDryCleanTotal(items, 0);
    expect(result.subtotalCents).toBe(3800);
    expect(result.totalCents).toBe(3800);
  });

  it("applies discount to dry cleaning total", () => {
    const items: Record<string, DryCleanEntry> = {
      dress_shirt: { label: "Dress Shirt", category: "Tops", unit_price_cents: 600, qty: 5, total_cents: 3000 },
    };
    // 5 × $6 = $30 → 10% off = $27
    const result = calcDryCleanTotal(items, 10);
    expect(result.subtotalCents).toBe(3000);
    expect(result.totalCents).toBe(2700);
  });

  it("returns zero for empty items", () => {
    const result = calcDryCleanTotal({}, 0);
    expect(result.subtotalCents).toBe(0);
    expect(result.totalCents).toBe(0);
  });
});

describe("centsToDollars", () => {
  it("converts cents to dollar string with two decimals", () => {
    expect(centsToDollars(4500)).toBe("45.00");
    expect(centsToDollars(6250)).toBe("62.50");
    expect(centsToDollars(75)).toBe("0.75");
    expect(centsToDollars(0)).toBe("0.00");
  });
});
