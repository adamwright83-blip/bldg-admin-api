import { describe, expect, it } from "vitest";
import { summarizeComparablePeriods } from "./strategicEvidenceReaders";
import { describeObservedComparison } from "./strategicDiagnosis";

const ev = (businessDate: string, phone: string | null, cents = 4000) => ({
  businessDate,
  cents,
  identity: phone ? { phone } : {},
});

describe("comparable-period evidence", () => {
  it("compares trailing, prior, and month-to-date periods and splits new vs returning", () => {
    const s = summarizeComparablePeriods(
      [ev("2026-08-20", "5155550001"), ev("2026-10-01", "5155550001"), ev("2026-10-10", "5155550002"), ev("2026-09-05", "5155550003"), ev("2026-10-11", null)],
      "2026-10-13"
    )!;
    expect(s.current).toEqual({ orders: 3, cents: 12000 });
    expect(s.prior).toEqual({ orders: 2, cents: 8000 });
    expect(s.mtd.orders).toBe(3);
    expect(s.priorMtd.orders).toBe(1);
    expect(s.customers).toEqual({ newCustomers: 1, returningCustomers: 1, unidentifiedOrders: 1 });
  });
  it("an unreadable ledger is missing, never zero", () => {
    expect(summarizeComparablePeriods(null, "2026-10-13")).toBeNull();
  });
  it("states only comparisons whose both sides were observed", () => {
    const out = describeObservedComparison({ sales: 20000, priorSales: null, orders: 5, priorOrders: null, aov: 4000, mtd: null, priorMtd: null, newCustomers: null, returningCustomers: null, dormant: null });
    expect(out.lines).toEqual([]);
    expect(out.missing).toEqual(["Prior-period sales comparison", "Month-to-date comparison", "New versus returning customer mix", "Dormant customer count"]);
  });
});
