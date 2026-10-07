import { describe, expect, it } from "vitest";
import { chooseDaphneActiveLearningAction } from "./activeLearning";
describe("Daphne V2 safe active learning",()=>{
 const actions=[
  {key:"brief",risk:"low" as const,estimatedUtility:.8,uncertainty:.6,burden:.1},
  {key:"ask",risk:"low" as const,estimatedUtility:.6,uncertainty:.8,burden:.1},
  {key:"change_payment",risk:"high" as const,estimatedUtility:1,uncertainty:1,burden:.1,touchesBusinessTruth:true},
 ];
 it("never experiments on business-truth or high-risk actions",()=>{
  const d=chooseDaphneActiveLearningAction({actions,experimentationEnabled:true,draw:.99});
  expect(d.acceptableActions).not.toContain("change_payment"); expect(d.propensity?.change_payment).toBeUndefined();
 });
 it("becomes deterministic when user disables experimentation",()=>{
  expect(chooseDaphneActiveLearningAction({actions,experimentationEnabled:false}).selectionMode).toBe("deterministic");
 });
});
