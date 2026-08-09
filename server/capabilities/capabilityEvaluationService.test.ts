import { describe, expect, it } from "vitest";
import { evaluateFirstHireReadiness, type FirstHireInputs } from "./capabilityEvaluationService";

const ready: FirstHireInputs={activeNonOwnerMembers:0,utilizationPct:90,profitableDeclinedDemandCents:100000,marginPct:30,reserveMonths:4,recurringWorkloadPct:50,scheduleSaturationPct:85,trailingDemandRevenueCents:2000000};
describe("FIRST_HIRE_READY capability",()=>{
  it("is ready only when every real-business condition passes",()=>expect(evaluateFirstHireReadiness(ready).status).toBe("READY"));
  it("does not falsely unlock with missing data",()=>{const result=evaluateFirstHireReadiness({...ready,reserveMonths:null});expect(result.status).toBe("LOCKED");expect(result.blockingConditions).toContain("reserveMonths is unavailable")});
  it("reports approaching for partial but complete evidence",()=>expect(evaluateFirstHireReadiness({...ready,reserveMonths:1,marginPct:10,scheduleSaturationPct:50}).status).toBe("APPROACHING"));
  it("is active only after a real non-owner member exists",()=>expect(evaluateFirstHireReadiness({...ready,activeNonOwnerMembers:1}).status).toBe("ACTIVE"));
});
