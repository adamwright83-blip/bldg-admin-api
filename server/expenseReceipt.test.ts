import { describe, expect, it } from "vitest";
import { isGasExpense, normalizeParsedExpenseReceipt } from "./expenseReceipt";

describe("driver expense receipt guard", () => {
  it("allows confident gas receipts with a positive total", () => {
    expect(isGasExpense({ category: "gas", confidence: 0.9, totalCents: 4217 })).toBe(true);
  });

  it("blocks non-gas and low-confidence receipts before writing to Sheets", () => {
    expect(isGasExpense({ category: "food", confidence: 0.96, totalCents: 1800 })).toBe(false);
    expect(isGasExpense({ category: "gas", confidence: 0.4, totalCents: 4217 })).toBe(false);
    expect(isGasExpense({ category: "gas", confidence: 0.9, totalCents: 0 })).toBe(false);
  });

  it("corrects mistaken other category when pump receipt has strong fuel evidence", () => {
    const parsed = normalizeParsedExpenseReceipt({
      category: "other",
      vendorName: null,
      receiptDate: "5/12/26 9:25",
      totalCents: 5607,
      confidence: 0.62,
      warnings: [],
      gasEvidence: {
        pumpNumber: "05",
        fuelProduct: "UNLEADED",
        gallons: 3.347,
        pricePerGallonCents: 600,
        fuelSaleCents: 5607,
      },
    });

    expect(parsed.category).toBe("gas");
    expect(parsed.confidence).toBeGreaterThanOrEqual(0.78);
    expect(isGasExpense(parsed)).toBe(true);
  });

  it("does not correct ordinary non-gas receipts without fuel evidence", () => {
    const parsed = normalizeParsedExpenseReceipt({
      category: "other",
      vendorName: "Staples",
      receiptDate: "2026-05-12",
      totalCents: 2499,
      confidence: 0.9,
      warnings: [],
      gasEvidence: {
        pumpNumber: null,
        fuelProduct: null,
        gallons: null,
        pricePerGallonCents: null,
        fuelSaleCents: null,
      },
    });

    expect(parsed.category).toBe("other");
    expect(isGasExpense(parsed)).toBe(false);
  });
});
