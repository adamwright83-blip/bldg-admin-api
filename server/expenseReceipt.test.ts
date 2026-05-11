import { describe, expect, it } from "vitest";
import { isGasExpense } from "./expenseReceipt";

describe("driver expense receipt guard", () => {
  it("allows confident gas receipts with a positive total", () => {
    expect(isGasExpense({ category: "gas", confidence: 0.9, totalCents: 4217 })).toBe(true);
  });

  it("blocks non-gas and low-confidence receipts before writing to Sheets", () => {
    expect(isGasExpense({ category: "food", confidence: 0.96, totalCents: 1800 })).toBe(false);
    expect(isGasExpense({ category: "gas", confidence: 0.4, totalCents: 4217 })).toBe(false);
    expect(isGasExpense({ category: "gas", confidence: 0.9, totalCents: 0 })).toBe(false);
  });
});
