import { describe, expect, it } from "vitest";
import { summarizeComparablePeriods } from "./strategicEvidenceReaders";
import { assembleStrategicDiagnosis, describeObservedComparison } from "./strategicDiagnosis";
import { defaultVerticalRegistry } from "./verticalTemplates/defaultRegistry";

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

describe("stale sales sources", () => {
  it("recommends restoring the source and labels recorded figures as incomplete", () => {
    const now = new Date("2026-10-13T20:00:00Z");
    const at = now.toISOString();
    const e = (id: string, value: number | string, quality: "complete" | "partial") => ({
      id, tenantId: "t", source: "test", capturedAt: at,
      classification: quality === "complete" ? ("verified" as const) : ("estimate" as const),
      value, unit: id, quality, description: id,
    });
    const d = assembleStrategicDiagnosis(
      {
        tenantId: "t", canonicalOperatorId: "op", verticalKey: "laundry_fluff_fold",
        businessDate: "2026-10-13", now,
        goal: { statement: "Get to 50 active customers", metricKey: "active_customers", target: 50, current: null, evidenceRef: "goal" },
        evidence: [e("goal", "Get to 50 active customers", "complete"), e("net_sales_cents", 187416, "partial"), e("prior_net_sales_cents", 252325, "partial"), e("dormant_customers", 87, "complete"), e("gap", "CleanCloud stale", "complete")],
        metrics: { net_sales_cents: "net_sales_cents", prior_net_sales_cents: "prior_net_sales_cents", dormant_customers: "dormant_customers" },
        market: { tenantId: "t", mode: "physical", territories: [], observations: [], limitations: [] },
        outcomes: [], commitments: [],
        sourceGaps: { evidenceRef: "gap", description: "CleanCloud stale" },
      },
      defaultVerticalRegistry
    );
    expect(d.quality.structuralErrors).toEqual([]);
    // Partial sales never drive a recovery recommendation.
    expect(d.primaryConstraint).toBe("investigation");
    expect(d.selectedApproach).toMatch(/^Restore the stale sales data source/);
    expect(d.options[0]!.observedBasis).toMatch(/^Recorded, incomplete: Recorded sales last 30 days \$1874\.16 vs \$2523\.25/);
    expect(d.options[1]!.reason).toMatch(/^Not preferred/);
  });
});
