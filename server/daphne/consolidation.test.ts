import { describe, expect, it } from "vitest";
import { planDaphneConsolidation } from "./consolidation";
describe("Daphne V2 consolidation/dreaming",()=>{
 it("never proposes deleting immutable observations",()=>{
  const p=planDaphneConsolidation({observations:[{id:"obs"} as any],claims:[],asOf:new Date()});
  expect(p.noDeletion).toBe(true); expect(p.retainedObservationIds).toEqual(["obs"]);
 });
});
