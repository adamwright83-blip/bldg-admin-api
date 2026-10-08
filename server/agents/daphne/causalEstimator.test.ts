import { describe, expect, it } from "vitest";
import { estimateDaphneBinaryTreatmentEffect } from "./causalEstimator";
describe("Daphne V2 causal estimator",()=>{
 const rows=[
  {observationId:"1",action:"brief",outcome:1,propensity:.5,selectionMode:"randomized" as const},
  {observationId:"2",action:"brief",outcome:1,propensity:.5,selectionMode:"randomized" as const},
  {observationId:"3",action:"brief",outcome:0,propensity:.5,selectionMode:"randomized" as const},
  {observationId:"4",action:"none",outcome:0,propensity:.5,selectionMode:"randomized" as const},
  {observationId:"5",action:"none",outcome:0,propensity:.5,selectionMode:"randomized" as const},
  {observationId:"6",action:"none",outcome:1,propensity:.5,selectionMode:"randomized" as const},
 ];
 it("uses logged randomization and reports causal status without pretending certainty",()=>{
  const e=estimateDaphneBinaryTreatmentEffect({samples:rows,treatmentAction:"brief",controlAction:"none"});
  expect(e.causalEvidenceStatus).toBe("randomized"); expect(e.effect).toBeCloseTo(1/3,5); expect(e.epistemicStatus).toBe("suggestive");
 });
 it("fails positivity rather than accepting near-deterministic assignments",()=>{
  expect(()=>estimateDaphneBinaryTreatmentEffect({samples:rows.map((r,i)=>i===0?{...r,propensity:.001}:r),treatmentAction:"brief",controlAction:"none"})).toThrow(/positivity/);
 });
});
