/**
 * Deterministic arithmetic over canonical, tenant-scoped metric observations.
 *
 * This is a pure, read-only semantic computation boundary. The model may
 * propose an expression; only an authorized data adapter may populate the
 * observations. This module neither fetches data nor changes payment truth.
 */
import { METRICS, type MetricUnit } from "./metricRegistry";

export type MetricObservation = {
  metricId: string;
  tenantId: string;
  /** An independently authorized analytics provider's evidence reference. */
  sourceRef: string;
  period: { start: string; end: string };
  value: number;
  unit: MetricUnit;
  verified: boolean;
  stale: boolean;
};

export type MetricExpression =
  | { kind: "observation"; key: string }
  | { kind: "add" | "subtract"; left: MetricExpression; right: MetricExpression }
  | { kind: "divide"; numerator: MetricExpression; denominator: MetricExpression }
  | { kind: "percent_change"; current: MetricExpression; previous: MetricExpression };

export type DerivedMetric = {
  value: number;
  unit: string;
  /** Distinct original evidence references; never model-produced citations. */
  sourceRefs: string[];
  expression: MetricExpression;
  period: { start: string; end: string } | null;
};

export class GovernedMetricError extends Error {
  constructor(public readonly code:
    | "BAD_EXPRESSION" | "MISSING_EVIDENCE" | "UNAUTHORIZED"
    | "UNVERIFIED" | "STALE" | "BAD_VALUE" | "UNIT_MISMATCH"
    | "PERIOD_MISMATCH" | "DIVISION_BY_ZERO", message: string) {
    super(message);
    this.name = "GovernedMetricError";
  }
}

type InternalValue = {
  value: number;
  unit: string;
  sourceRefs: Set<string>;
  period: MetricObservation["period"] | null;
};

const ISO_YMD = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NODES = 32;
const MAX_DEPTH = 12;

function samePeriod(a: InternalValue, b: InternalValue): boolean {
  return Boolean(a.period && b.period &&
    a.period.start === b.period.start && a.period.end === b.period.end);
}

function mergeRefs(a: InternalValue, b: InternalValue): Set<string> {
  return new Set([...a.sourceRefs, ...b.sourceRefs]);
}

function ensureFinite(value: number): number {
  if (!Number.isFinite(value)) {
    throw new GovernedMetricError("BAD_VALUE", "Non-finite analytical result");
  }
  return value;
}

/**
 * Evaluate an explicitly proposed arithmetic expression against evidence that
 * the caller already obtained through tenant-authorized, canonical read ports.
 *
 * No free-form SQL, unsafe joins, invented metric IDs, or arbitrary literals.
 * Consumers must still check underlying source completeness and permissions.
 */
export function evaluateGovernedMetricExpression(input: {
  tenantId: string;
  expression: MetricExpression;
  observations: Readonly<Record<string, MetricObservation>>;
}): DerivedMetric {
  if (!input.tenantId.trim()) {
    throw new GovernedMetricError("UNAUTHORIZED", "Resolved tenant authority required");
  }
  let nodeCount = 0;
  const evaluate = (node: MetricExpression, depth: number): InternalValue => {
    if (++nodeCount > MAX_NODES || depth > MAX_DEPTH || !node) {
      throw new GovernedMetricError("BAD_EXPRESSION", "Metric expression is too large");
    }
    if (node.kind === "observation") {
      const item = input.observations[node.key];
      if (!item) {
        throw new GovernedMetricError("MISSING_EVIDENCE", "Metric observation unavailable");
      }
      if (item.tenantId !== input.tenantId) {
        throw new GovernedMetricError("UNAUTHORIZED", "Metric observation belongs to another tenant");
      }
      const definition = Object.hasOwn(METRICS, item.metricId) ? METRICS[item.metricId] : null;
      if (!definition || definition.unit !== item.unit) {
        throw new GovernedMetricError("UNIT_MISMATCH", "Metric is not governed by the registry");
      }
      if (!item.verified || !item.sourceRef.trim()) {
        throw new GovernedMetricError("UNVERIFIED", "Metric observation is not verifiable");
      }
      if (item.stale) {
        throw new GovernedMetricError("STALE", "Metric observation is stale");
      }
      if (!Number.isFinite(item.value) || !ISO_YMD.test(item.period.start) ||
          !ISO_YMD.test(item.period.end) || item.period.start > item.period.end) {
        throw new GovernedMetricError("BAD_VALUE", "Metric value or date period is invalid");
      }
      return {
        value: item.value,
        unit: item.unit,
        sourceRefs: new Set([item.sourceRef]),
        period: item.period,
      };
    }
    if (node.kind === "add" || node.kind === "subtract") {
      const left = evaluate(node.left, depth + 1);
      const right = evaluate(node.right, depth + 1);
      if (left.unit !== right.unit) {
        throw new GovernedMetricError("UNIT_MISMATCH", "Cannot add or subtract different metric units");
      }
      if (!samePeriod(left, right)) {
        throw new GovernedMetricError("PERIOD_MISMATCH", "Metric periods must match for arithmetic");
      }
      return {
        value: ensureFinite(node.kind === "add" ? left.value + right.value : left.value - right.value),
        unit: left.unit,
        sourceRefs: mergeRefs(left, right),
        period: left.period,
      };
    }
    if (node.kind === "divide") {
      const left = evaluate(node.numerator, depth + 1);
      const right = evaluate(node.denominator, depth + 1);
      if (!samePeriod(left, right)) {
        throw new GovernedMetricError("PERIOD_MISMATCH", "Metric periods must match for ratios");
      }
      if (right.value === 0) {
        throw new GovernedMetricError("DIVISION_BY_ZERO", "Cannot divide by zero");
      }
      return {
        value: ensureFinite(left.value / right.value),
        unit: left.unit === right.unit ? "ratio" : `${left.unit}_per_${right.unit}`,
        sourceRefs: mergeRefs(left, right),
        period: left.period,
      };
    }
    if (node.kind === "percent_change") {
      const current = evaluate(node.current, depth + 1);
      const previous = evaluate(node.previous, depth + 1);
      if (current.unit !== previous.unit) {
        throw new GovernedMetricError("UNIT_MISMATCH", "Percent change requires matching metric units");
      }
      if (previous.value === 0) {
        throw new GovernedMetricError("DIVISION_BY_ZERO", "Cannot calculate change from a zero baseline");
      }
      return {
        value: ensureFinite(((current.value - previous.value) / Math.abs(previous.value)) * 100),
        unit: "percent",
        sourceRefs: mergeRefs(current, previous),
        period: null,
      };
    }
    throw new GovernedMetricError("BAD_EXPRESSION", "Unknown expression operation");
  };
  const result = evaluate(input.expression, 0);
  return {
    value: result.value,
    unit: result.unit,
    sourceRefs: [...result.sourceRefs].sort(),
    period: result.period,
    expression: input.expression,
  };
}
