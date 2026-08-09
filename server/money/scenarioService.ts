import { deterministicEstimate, type ProvenancedValue } from "../../shared/businessGame";
import type { MoneyScenario } from "./moneyTypes";

type ScenarioInput = {
  scenarioType: MoneyScenario["scenarioType"];
  availableCashCents: number | null;
  reserveRequirementCents: number | null;
  requiredCashCents: number;
  recurringCostMonthlyCents: number;
  capacityChangeUnits: number | null;
  expectedMonthlyRevenueLowCents: number | null;
  expectedMonthlyRevenueHighCents: number | null;
};

function estimate<T>(value: T, source: string): ProvenancedValue<T> {
  return deterministicEstimate(value, source, "medium");
}

export function evaluateMoneyScenario(input: ScenarioInput): MoneyScenario {
  const missingInformation: string[] = [];
  if (input.availableCashCents == null) missingInformation.push("available cash");
  if (input.reserveRequirementCents == null) missingInformation.push("reserve requirement");
  if (input.capacityChangeUnits == null) missingInformation.push("capacity change");
  if (input.expectedMonthlyRevenueLowCents == null || input.expectedMonthlyRevenueHighCents == null) missingInformation.push("expected monthly revenue range");
  const reserveAfter = input.availableCashCents == null ? null : input.availableCashCents - input.requiredCashCents;
  const low = input.expectedMonthlyRevenueLowCents;
  const high = input.expectedMonthlyRevenueHighCents;
  const netLow = low == null ? null : low - input.recurringCostMonthlyCents;
  const netHigh = high == null ? null : high - input.recurringCostMonthlyCents;
  const breakEven = netLow != null && netHigh != null && netHigh > 0
    ? { low: Math.max(0, Math.ceil(input.requiredCashCents / Math.max(1, netHigh))), high: netLow > 0 ? Math.ceil(input.requiredCashCents / netLow) : Number.POSITIVE_INFINITY }
    : null;
  return {
    scenarioType: input.scenarioType,
    requiredCash: estimate(input.requiredCashCents, "operator scenario input"),
    reserveAfterAction: reserveAfter == null ? { value: null, provenance: "UNKNOWN", sourceReference: "Available cash is unknown", confidence: "unknown" } : estimate(reserveAfter, "available cash minus required cash"),
    recurringCostMonthly: estimate(input.recurringCostMonthlyCents, "operator scenario input"),
    capacityChange: input.capacityChangeUnits == null ? { value: null, provenance: "UNKNOWN", sourceReference: "Capacity change is unknown", confidence: "unknown" } : estimate(input.capacityChangeUnits, "operator scenario input"),
    expectedRevenueRange: low == null || high == null ? { value: null, provenance: "UNKNOWN", sourceReference: "Expected revenue range is incomplete", confidence: "unknown" } : estimate({ lowCents: low, highCents: high }, "operator scenario assumptions"),
    breakEvenMonths: breakEven == null ? { value: null, provenance: "UNKNOWN", sourceReference: "Break-even cannot be computed safely", confidence: "unknown" } : estimate(breakEven, "required cash / monthly revenue net of recurring cost"),
    assumptions: ["All scenario inputs are operator-supplied estimates, not actual revenue", "Taxes, financing, timing, and demand conversion are excluded unless reflected in supplied values"],
    missingInformation,
  };
}
