import { describe, expect, it } from "vitest";
import { buildDaphneHierarchicalPrior, shrinkDaphneUserRateTowardPrior } from "./hierarchicalPrior";
describe("Daphne V2 hierarchical cold start",()=>{
 const a={actionKey:"brief",contextKey:"execution",cohortUserCount:50,successes:30,failures:20};
 it("requires explicit cross-user learning permission",()=>expect(buildDaphneHierarchicalPrior({aggregate:a,crossUserLearningEnabled:false}).usable).toBe(false));
 it("refuses sensitive context segmentation",()=>expect(buildDaphneHierarchicalPrior({aggregate:{...a,contextKey:"ADHD"},crossUserLearningEnabled:true}).reason).toBe("forbidden_sensitive_context"));
 it("uses only sufficiently large aggregate cohorts",()=>{
  const p=buildDaphneHierarchicalPrior({aggregate:a,crossUserLearningEnabled:true}); expect(p.usable).toBe(true);
  expect(shrinkDaphneUserRateTowardPrior({successes:1,failures:0,prior:p})).not.toBeNull();
 });
});
