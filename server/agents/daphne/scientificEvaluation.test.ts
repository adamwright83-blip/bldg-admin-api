import { describe, expect, it } from "vitest";
import { compareDaphneToBaseline, evaluateDaphnePredictions } from "./scientificEvaluation";
describe("Daphne V2 scientific evaluation harness",()=>{
 it("reports calibration and burden together",()=>{
  const e=evaluateDaphnePredictions({minN:2,cases:[
   {prediction:.8,outcome:1,contextKey:"a",actionKey:"brief",burden:.1,causalStatus:"randomized"},
   {prediction:.2,outcome:0,contextKey:"b",actionKey:"none",burden:0,causalStatus:"randomized"}
  ]});
  expect(e.verdict).toBe("measured"); expect(e.brierScore).toBeCloseTo(.04,5); expect(e.meanBurden).toBe(.05);
 });
 it("will not manufacture a winner with insufficient data",()=>{
  const e=evaluateDaphnePredictions({cases:[{prediction:.9,outcome:1,contextKey:"a",actionKey:"x"}]});
  expect(compareDaphneToBaseline({daphne:e,baseline:e}).verdict).toBe("insufficient_data");
 });
});
