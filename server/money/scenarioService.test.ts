import { describe, expect, it } from "vitest";
import { evaluateMoneyScenario } from "./scenarioService";

describe("MONEY scenario engine",()=>{
  it("returns insufficient data instead of invented expansion effects",()=>{
    const value=evaluateMoneyScenario({scenarioType:"first_hire",availableCashCents:null,reserveRequirementCents:null,requiredCashCents:500000,recurringCostMonthlyCents:400000,capacityChangeUnits:null,expectedMonthlyRevenueLowCents:null,expectedMonthlyRevenueHighCents:null});
    expect(value.reserveAfterAction.provenance).toBe("UNKNOWN");
    expect(value.breakEvenMonths.value).toBeNull();
    expect(value.missingInformation).toContain("reserve requirement");
  });
  it("uses transparent operator assumptions when all values exist",()=>{
    const value=evaluateMoneyScenario({scenarioType:"equipment",availableCashCents:2000000,reserveRequirementCents:500000,requiredCashCents:600000,recurringCostMonthlyCents:10000,capacityChangeUnits:20,expectedMonthlyRevenueLowCents:210000,expectedMonthlyRevenueHighCents:310000});
    expect(value.reserveAfterAction.value).toBe(1400000);
    expect(value.breakEvenMonths.value).toEqual({low:2,high:3});
    expect(value.expectedRevenueRange.provenance).toBe("DETERMINISTIC_ESTIMATE");
  });
});
