import { describe, expect, it } from "vitest";
import {
  evaluateGovernedMetricExpression,
  GovernedMetricError,
  type MetricExpression,
  type MetricObservation,
} from "./governedMetricExpression";

const current = { start: "2026-09-01", end: "2026-09-30" };
const previous = { start: "2026-08-01", end: "2026-08-31" };
const obs = (metricId: string, value: number, unit: MetricObservation["unit"], period = current): MetricObservation => ({
  metricId, value, unit, period,
  tenantId: "tenant_a",
  sourceRef: `canonical:${metricId}:${period.start}`,
  verified: true, stale: false,
});
const ref = (key: string): MetricExpression => ({ kind: "observation", key });
const execute = (expression: MetricExpression, observations: Record<string, MetricObservation>) =>
  evaluateGovernedMetricExpression({ tenantId: "tenant_a", expression, observations });

describe("governed derived business metrics", () => {
  it("computes AOV from independently grounded revenue and paid orders", () => {
    const result = execute(
      { kind: "divide", numerator: ref("revenue"), denominator: ref("orders") },
      { revenue: obs("revenue_paid_stripe", 420, "currency"),
        orders: obs("orders_paid", 8, "count") }
    );
    expect(result.value).toBe(52.5);
    expect(result.unit).toBe("currency_per_count");
    expect(result.sourceRefs).toHaveLength(2);
    expect(result.period).toEqual(current);
  });

  it("computes period growth without asking the model to calculate numbers", () => {
    const result = execute({ kind: "percent_change", current: ref("now"), previous: ref("prior") }, {
      now: obs("revenue_paid_stripe", 450, "currency"),
      prior: obs("revenue_paid_stripe", 300, "currency", previous),
    });
    expect(result.value).toBe(50);
    expect(result.unit).toBe("percent");
    expect(result.period).toBeNull();
  });

  it("rejects cross-tenant evidence even when the model supplied its key", () => {
    const item = { ...obs("revenue_paid_stripe", 42, "currency"), tenantId: "tenant_b" };
    expect(() => execute(ref("other"), { other: item }))
      .toThrowError(GovernedMetricError);
    expect(() => execute(ref("other"), { other: item }))
      .toThrow("another tenant");
  });

  it("refuses stale, unverified, unknown and missing metric evidence", () => {
    const valid = obs("revenue_paid_stripe", 42, "currency");
    const examples = [
      { ...valid, stale: true },
      { ...valid, verified: false },
      { ...valid, metricId: "fabricated_labor_margin" },
      { ...valid, sourceRef: "" },
    ];
    for (const item of examples) {
      expect(() => execute(ref("x"), { x: item })).toThrow(GovernedMetricError);
    }
    expect(() => execute(ref("not_found"), {})).toThrow(GovernedMetricError);
  });

  it("does not subtract orders from dollars or mix different periods", () => {
    const expression: MetricExpression = { kind: "subtract", left: ref("x"), right: ref("y") };
    expect(() => execute(expression, {
      x: obs("revenue_paid_stripe", 500, "currency"),
      y: obs("orders_paid", 3, "count"),
    })).toThrow("different metric units");
    expect(() => execute(expression, {
      x: obs("revenue_paid_stripe", 500, "currency"),
      y: obs("revenue_paid_stripe", 300, "currency", previous),
    })).toThrow("periods must match");
  });

  it("returns unavailable rather than inferring a ratio with denominator zero", () => {
    expect(() => execute({
      kind: "divide", numerator: ref("x"), denominator: ref("zero"),
    }, {
      x: obs("revenue_paid_stripe", 400, "currency"),
      zero: obs("orders_paid", 0, "count"),
    })).toThrow("divide by zero");
  });

  it("disallows unbounded expression depth", () => {
    let expression: MetricExpression = ref("x");
    for (let i = 0; i < 15; i++) {
      expression = { kind: "add", left: expression, right: ref("x") };
    }
    expect(() => execute(expression, { x: obs("revenue_paid_stripe", 1, "currency") }))
      .toThrow("too large");
  });
});
