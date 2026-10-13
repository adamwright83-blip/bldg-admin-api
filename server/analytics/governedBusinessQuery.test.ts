import { describe, expect, it } from "vitest";
import { defaultBusinessQuery, runBusinessQuery, type BusinessQuery, type BusinessQueryDeps } from "./businessQuery";
import { runGovernedBusinessPlan } from "./governedBusinessQuery";
import { GovernedMetricError } from "./governedMetricExpression";
import { loadPaidOrderLedger, type LedgerLoaders } from "./paidOrderLedger";
import {
  emptyLoaders,
  failingLoaders,
  FIXTURE_NOW,
  FIXTURE_TZ,
  fixtureCompleteness,
  fixtureLoaders,
  withFixturePaymentAuthority,
} from "./businessLedgerFixture";

function deps(loaders: LedgerLoaders): BusinessQueryDeps {
  return {
    loadLedger: input => loadPaidOrderLedger(input, withFixturePaymentAuthority(loaders)),
    loadOpenOrders: async () => ({ openTotal: 4, byStatus: {}, awaitingPayment: 1 }),
    loadCompleteness: async () => fixtureCompleteness,
    now: () => FIXTURE_NOW,
    timeZone: () => FIXTURE_TZ,
  };
}

describe("Governed Business Query — Production Path", () => {
  it("computes supported derived metrics through runBusinessQuery production path", async () => {
    const query: BusinessQuery = {
      ...defaultBusinessQuery("revenue"),
      period: { kind: "between", start: "2026-08-01", end: "2026-08-31" },
      calculation: {
        version: 1,
        observations: [
          { key: "rev", metricId: "revenue_paid_stripe", period: "current" },
          { key: "orders", metricId: "orders_paid", period: "current" },
        ],
        outputs: [
          {
            key: "aov",
            expression: {
              kind: "divide",
              numerator: { kind: "observation", key: "rev" },
              denominator: { kind: "observation", key: "orders" },
            },
          },
        ],
      },
    };

    const result = await runBusinessQuery("tenant-1", query, deps(fixtureLoaders()));
    expect(result.status).toBe("ok");
    if (result.status !== "ok" || result.data.kind !== "calculation") throw new Error("Expected calculation result");

    const { calculation } = result.data;
    expect(calculation.tenantId).toBe("tenant-1");
    expect(calculation.cells).toHaveLength(1);
    const aovCell = calculation.cells[0]!;
    expect(aovCell.key).toBe("aov");
    // $155 revenue / 4 orders = $38.75 AOV
    expect(aovCell.value).toBe(38.75);
    expect(aovCell.unit).toBe("currency_per_count");
    expect(aovCell.precision).toBe("recorded_only");
    expect(aovCell.sourceRefs.length).toBeGreaterThan(0);
  });

  it("computes period-over-period growth with comparison periods", async () => {
    const query: BusinessQuery = {
      ...defaultBusinessQuery("revenue"),
      period: { kind: "between", start: "2026-08-01", end: "2026-08-31" },
      comparison: { kind: "between", start: "2026-07-01", end: "2026-07-31" },
      calculation: {
        version: 1,
        observations: [
          { key: "current_rev", metricId: "revenue_paid_stripe", period: "current" },
          { key: "prev_rev", metricId: "revenue_paid_stripe", period: "previous" },
        ],
        outputs: [
          {
            key: "growth",
            expression: {
              kind: "percent_change",
              current: { kind: "observation", key: "current_rev" },
              previous: { kind: "observation", key: "prev_rev" },
            },
          },
        ],
      },
    };

    const result = await runBusinessQuery("tenant-1", query, deps(fixtureLoaders()));
    expect(result.status).toBe("ok");
    if (result.status !== "ok" || result.data.kind !== "calculation") throw new Error("Expected calculation result");

    const growthCell = result.data.calculation.cells[0]!;
    expect(growthCell.key).toBe("growth");
    // July CleanCloud order: $30. August native: $155. (155 - 30) / 30 * 100 = 416.666...%
    expect(growthCell.value).toBeCloseTo(416.67, 1);
    expect(growthCell.unit).toBe("percent");
  });


  it("handles missing or unavailable data explicitly without substituting zero", async () => {
    const query: BusinessQuery = {
      ...defaultBusinessQuery("revenue"),
      calculation: {
        version: 1,
        observations: [
          { key: "rev", metricId: "revenue_paid_stripe", period: "current" },
          { key: "unknown_metric", metricId: "unconnected_cost_of_goods", period: "current" },
        ],
        outputs: [
          {
            key: "margin",
            expression: {
              kind: "subtract",
              left: { kind: "observation", key: "rev" },
              right: { kind: "observation", key: "unknown_metric" },
            },
          },
        ],
      },
    };

    const result = await runBusinessQuery("tenant-1", query, deps(fixtureLoaders()));
    expect(result.status).toBe("ok");
    if (result.status !== "ok" || result.data.kind !== "calculation") throw new Error("Expected calculation result");

    const marginCell = result.data.calculation.cells[0]!;
    expect(marginCell.value).toBeNull();
    expect(marginCell.precision).toBe("missing");
    expect(marginCell.reason).toMatch(/No authorized source is connected/i);

    const obsRecord = result.data.calculation.observations.find(o => o.key === "unknown_metric");
    expect(obsRecord?.value).toBeNull();
    expect(obsRecord?.precision).toBe("missing");
  });

  it("handles failing underlying source by marking precision missing and reporting error", async () => {
    const query: BusinessQuery = {
      ...defaultBusinessQuery("revenue"),
      calculation: {
        version: 1,
        observations: [
          { key: "rev", metricId: "revenue_paid_stripe", period: "current" },
        ],
        outputs: [
          {
            key: "total",
            expression: { kind: "observation", key: "rev" },
          },
        ],
      },
    };

    const result = await runBusinessQuery("tenant-1", query, deps(failingLoaders));
    expect(result.status).toBe("ok");
    if (result.status !== "ok" || result.data.kind !== "calculation") throw new Error("Expected calculation result");

    const cell = result.data.calculation.cells[0]!;
    expect(cell.value).toBeNull();
    expect(cell.precision).toBe("missing");
    expect(cell.reason).toMatch(/unavailable/i);
  });

  it("enforces tenant isolation and rejects mismatched tenant sub-query results", async () => {
    const query: BusinessQuery = {
      ...defaultBusinessQuery("revenue"),
      calculation: {
        version: 1,
        observations: [
          { key: "rev", metricId: "revenue_paid_stripe", period: "current" },
        ],
        outputs: [
          { key: "rev_out", expression: { kind: "observation", key: "rev" } },
        ],
      },
    };

    // If an adapter returns data belonging to tenant-2 when tenant-1 was requested
    const leakingRunner = async (tenantId: string, q: BusinessQuery) => {
      const real = await runBusinessQuery("tenant-2", q, deps(fixtureLoaders()));
      return { ...real, tenantId: "tenant-2" };
    };

    const result = await runGovernedBusinessPlan({
      tenantId: "tenant-1",
      query,
      now: FIXTURE_NOW,
      timeZone: FIXTURE_TZ,
      runQuery: leakingRunner,
    });

    expect(result.cells[0]!.value).toBeNull();
    expect(result.cells[0]!.precision).toBe("missing");
    expect(result.cells[0]!.reason).toMatch(/tenant.*do not match/i);
  });

  it("strictly scopes query execution to the requested tenant ID", async () => {
    const seenTenants: string[] = [];
    const trackingLoaders = fixtureLoaders(seenTenants);

    const query: BusinessQuery = {
      ...defaultBusinessQuery("revenue"),
      calculation: {
        version: 1,
        observations: [
          { key: "rev", metricId: "revenue_paid_stripe", period: "current" },
          { key: "orders", metricId: "orders_paid", period: "current" },
        ],
        outputs: [
          {
            key: "aov",
            expression: {
              kind: "divide",
              numerator: { kind: "observation", key: "rev" },
              denominator: { kind: "observation", key: "orders" },
            },
          },
        ],
      },
    };

    await runBusinessQuery("tenant-alpha", query, deps(trackingLoaders));
    expect(seenTenants.length).toBeGreaterThan(0);
    expect(seenTenants.every(t => t === "tenant-alpha")).toBe(true);
  });
});
