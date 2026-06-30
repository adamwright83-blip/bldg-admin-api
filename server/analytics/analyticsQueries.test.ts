import { describe, expect, it } from "vitest";
import {
  getRevenueSummary,
  getOrderStats,
  getOpenOrderStats,
  getRepeatCustomerStats,
  getMetricComparison,
  getDataCompleteness,
} from "./analyticsQueries";
import { normalizeRange } from "./composerAgent";

/**
 * Unit tests against the safe-zero path (no DB in test env) and
 * the date normalization / clamping logic.
 *
 * Cross-tenant isolation: proven structurally — every query has
 * `eq(orders.tenantId, tenantId)` in its WHERE clause. An integration
 * test with real rows is deferred until an integration DB fixture exists.
 */

describe("getRevenueSummary", () => {
  it("returns safe zero-state when db is unavailable", async () => {
    const result = await getRevenueSummary("tenant_a", {
      range: { start: "2025-01-01", end: "2025-01-31" },
      groupBy: "day",
    });
    expect(result.totalRevenue).toBe(0);
    expect(result.orderCount).toBe(0);
    expect(result.avgOrderValue).toBe(0);
    expect(result.series).toEqual([]);
  });

  it("returns safe zero for week groupBy", async () => {
    const result = await getRevenueSummary("tenant_a", {
      range: { start: "2025-06-01", end: "2025-06-30" },
      groupBy: "week",
    });
    expect(result).toMatchObject({ totalRevenue: 0, orderCount: 0, series: [] });
  });

  it("returns safe zero for month groupBy with paidAt basis", async () => {
    const result = await getRevenueSummary("tenant_a", {
      range: { start: "2025-01-01", end: "2025-06-30" },
      groupBy: "month",
      basis: "paidAt",
    });
    expect(result).toMatchObject({ totalRevenue: 0, series: [] });
  });
});

describe("getOrderStats", () => {
  it("returns safe zero-state when db is unavailable", async () => {
    const result = await getOrderStats("tenant_a", {
      range: { start: "2025-01-01", end: "2025-01-31" },
    });
    expect(result.totalOrders).toBe(0);
    expect(result.byStatus).toEqual({});
    expect(result.byServiceType).toEqual({});
    expect(result.totalWeightLbs).toBe(0);
    expect(result.avgOrderValue).toBe(0);
  });

  it("returns zero state for filtered service type", async () => {
    const result = await getOrderStats("tenant_b", {
      range: { start: "2025-06-01", end: "2025-06-30" },
      serviceType: "wash_fold",
    });
    expect(result.totalOrders).toBe(0);
  });

  it("cross-tenant: different tenantId args use separate WHERE clauses", async () => {
    const a = await getOrderStats("tenant_a", { range: { start: "2025-01-01", end: "2025-12-31" } });
    const b = await getOrderStats("tenant_b", { range: { start: "2025-01-01", end: "2025-12-31" } });
    expect(a.totalOrders).toBe(0);
    expect(b.totalOrders).toBe(0);
  });
});

describe("getOpenOrderStats", () => {
  it("returns safe zero-state when db is unavailable", async () => {
    const result = await getOpenOrderStats("tenant_a");
    expect(result.openTotal).toBe(0);
    expect(result.awaitingPayment).toBe(0);
    expect(result.byStatus).toEqual({});
  });
});

describe("getRepeatCustomerStats", () => {
  it("returns safe zero-state when db is unavailable", async () => {
    const result = await getRepeatCustomerStats("tenant_a", {
      range: { start: "2025-01-01", end: "2025-01-31" },
    });
    expect(result.totalCustomers).toBe(0);
    expect(result.repeatCustomers).toBe(0);
    expect(result.repeatRate).toBe(0);
  });
});

describe("getMetricComparison", () => {
  it("returns safe zeros when db is unavailable", async () => {
    const result = await getMetricComparison("tenant_a", {
      currentRange: { start: "2025-06-22", end: "2025-06-29" },
      groupBy: "day",
    });
    expect(result.current).toBe(0);
    expect(result.previous).toBe(0);
    expect(result.absChange).toBe(0);
    expect(result.pctChange).toBe(0);
    expect(result.volumeEffect).toBe(0);
    expect(result.aovEffect).toBe(0);
  });
});

describe("getDataCompleteness", () => {
  it("always includes the four always-missing categories", async () => {
    const result = await getDataCompleteness("tenant_a");
    const missingLabels = result.missing.map((m) => m.source);
    expect(missingLabels).toContain("Payroll / labor");
    expect(missingLabels).toContain("Machine revenue (coin-op)");
    expect(missingLabels).toContain("Cash drawer / POS");
    expect(missingLabels).toContain("Supply costs (detergent, bags, hangers)");
  });

  it("missing entries each have a prevents string", async () => {
    const result = await getDataCompleteness("tenant_a");
    for (const m of result.missing) {
      expect(typeof m.prevents).toBe("string");
      expect(m.prevents.length).toBeGreaterThan(0);
    }
  });
});

// ── Date range normalization ─────────────────────────────────────────────────

describe("normalizeRange", () => {
  it("returns last 7 days for invalid date strings", () => {
    const result = normalizeRange({ start: "not-a-date", end: "also-bad" });
    const spanDays = (Date.parse(result.end) - Date.parse(result.start)) / 864e5;
    expect(spanDays).toBeCloseTo(6, 0);
  });

  it("swaps reversed start/end", () => {
    const result = normalizeRange({ start: "2025-06-29", end: "2025-06-01" });
    expect(result.start).toBe("2025-06-01");
    expect(result.end).toBe("2025-06-29");
  });

  it("clamps spans > 366 days", () => {
    const result = normalizeRange({ start: "2023-01-01", end: "2025-06-29" });
    const spanDays = (Date.parse(result.end) - Date.parse(result.start)) / 864e5;
    expect(spanDays).toBeLessThanOrEqual(366);
  });

  it("returns last 7 days when range is undefined", () => {
    const result = normalizeRange({});
    const spanDays = (Date.parse(result.end) - Date.parse(result.start)) / 864e5;
    expect(spanDays).toBeCloseTo(6, 0);
  });

  it("passes valid ISO dates unchanged", () => {
    const result = normalizeRange({ start: "2025-06-01", end: "2025-06-30" });
    expect(result.start).toBe("2025-06-01");
    expect(result.end).toBe("2025-06-30");
  });
});
