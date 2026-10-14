import { describe, expect, it } from "vitest";
import { salesSourceOutage, summarizeComparablePeriods } from "./strategicEvidenceReaders";
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

describe("source outage vs payment-authority gap", () => {
  const cov = (over: Partial<{ cleanCloudStatus: string | null; snapshotRead: boolean; loadedSources: string[]; failedSources: string[] }>) => ({
    status: "ok" as const,
    coverage: { cleanCloudStatus: "fresh", snapshotRead: true, loadedSources: ["laundry_butler", "cleancloud"], failedSources: [], ...over },
  });
  it("a loaded source with missing payment receipts is not an outage", () => {
    // Production shape after the Oct 14 restore: both loaded, both flagged for receipts.
    expect(salesSourceOutage(cov({ failedSources: ["laundry_butler", "cleancloud"] }))).toEqual([]);
  });
  it("stale CleanCloud and unloadable sources are outages", () => {
    expect(salesSourceOutage(cov({ cleanCloudStatus: "stale" }))).toEqual(["CleanCloud stale"]);
    expect(salesSourceOutage(cov({ loadedSources: ["cleancloud"], failedSources: ["laundry_butler"] }))).toEqual(["laundry_butler could not be loaded"]);
  });

  it("Claire does not recommend repairing a healthy connection; recorded figures stay labelled unverified", () => {
    const now = new Date("2026-10-14T20:00:00Z");
    const at = now.toISOString();
    const e = (id: string, value: number | string, quality: "complete" | "partial") => ({
      id, tenantId: "t", source: "test", capturedAt: at,
      classification: quality === "complete" ? ("verified" as const) : ("estimate" as const),
      value, unit: id, quality, description: id,
    });
    const d = assembleStrategicDiagnosis(
      {
        tenantId: "t", canonicalOperatorId: "op", verticalKey: "laundry_fluff_fold", businessDate: "2026-10-14", now,
        goal: { statement: "Get to 50 active customers", metricKey: "active_customers", target: 50, current: null, evidenceRef: "goal" },
        evidence: [e("goal", "g", "complete"), e("net_sales_cents", 268997, "partial"), e("prior_net_sales_cents", 252325, "partial"), e("dormant_customers", 85, "complete"), e("gap", "31 recorded orders lack payment-authority receipts", "complete")],
        metrics: { net_sales_cents: "net_sales_cents", prior_net_sales_cents: "prior_net_sales_cents", dormant_customers: "dormant_customers" },
        market: { tenantId: "t", mode: "physical", territories: [], observations: [], limitations: [] },
        outcomes: [], commitments: [],
        recordedFigures: { evidenceRef: "gap", description: "31 recorded orders lack payment-authority receipts" },
      },
      defaultVerticalRegistry
    );
    expect(d.quality.structuralErrors).toEqual([]);
    expect(d.selectedApproach).not.toMatch(/Restore/);
    expect(d.diagnosis).not.toMatch(/incomplete|restore/i);
    expect(d.currentCondition).toContain("Recorded sales (sources current; not all orders payment-verified):");
    expect(d.currentCondition).toContain("$2689.97 vs $2523.25");
    expect(d.uncertainty.join(" ")).toContain("lack payment-authority receipts");
  });
});

describe("operator objective focus", () => {
  it("serves a neighborhood objective with equal-window comparison and named lapsed customers", () => {
    const now = new Date("2026-10-14T20:00:00Z");
    const at = now.toISOString();
    const e = (id: string, value: number | string) => ({
      id, tenantId: "t", source: "test", capturedAt: at, classification: "verified" as const,
      value, unit: id, quality: "complete" as const, description: id,
    });
    const d = assembleStrategicDiagnosis(
      {
        tenantId: "t", canonicalOperatorId: "op", verticalKey: "laundry_fluff_fold", businessDate: "2026-10-14", now,
        goal: { statement: "Get to 50 active customers", metricKey: "active_customers", target: 50, current: null, evidenceRef: "goal" },
        evidence: [e("goal", "g"), e("objective", "maximize sales in Silver Lake"), e("area_sales", 103000), e("area_dormant", 14)],
        metrics: {},
        market: { tenantId: "t", mode: "physical", territories: [], observations: [], limitations: [] },
        outcomes: [], commitments: [],
        focus: {
          statement: "maximize sales in Silver Lake", area: "Silver Lake", evidenceRef: "objective", windowDays: 90,
          sales: 103000, priorSales: 190000, orders: 13, priorOrders: 26, salesRef: "area_sales",
          dormant: 14, dormantRef: "area_dormant",
          dormantTop: [{ name: "Avery K.", lastOrderDate: "2026-07-02", revenueCents: 61000 }, { name: "Sam T.", lastOrderDate: "2026-06-20", revenueCents: 42000 }],
          figuresVerified: false,
        },
      },
      defaultVerticalRegistry
    );
    expect(d.quality.structuralErrors).toEqual([]);
    expect(d.objective).toEqual({ statement: "maximize sales in Silver Lake", area: "Silver Lake" });
    expect(d.selectedApproach).toBe("Win back lapsed Silver Lake customers");
    expect(d.currentCondition).toMatch(/^Your objective: maximize sales in Silver Lake\. Silver Lake recorded sales were \$1030\.00 over the last 90 days vs \$1900\.00 the prior 90 \(down 46%\), 13 vs 26 orders \(recorded; not all orders payment-verified\)\. 14 Silver Lake customers/);
    expect(d.actions[0]!.completionCondition).toContain("Avery K., Sam T.");
    expect(d.options[1]!.approach).toBe("Find new Silver Lake customers through building and door outreach");
    expect(d.uncertainty.join(" ")).toContain("Profitability can't be judged yet");
  });
});
