import { describe, expect, it } from "vitest";
import { summarizeDaphneMoatMetrics } from "./metrics";
describe("Daphne V2 moat instrumentation",()=>{
 it("measures the evidence-learning flywheel rather than vanity chat volume",()=>{
  const now=new Date();
  const s=summarizeDaphneMoatMetrics([
   {eventName:"observation_ingested",canonicalOperatorId:"u1",occurredAt:now},
   {eventName:"intervention_selected",canonicalOperatorId:"u1",occurredAt:now},
   {eventName:"outcome_linked",canonicalOperatorId:"u1",occurredAt:now},
   {eventName:"causal_estimate_created",canonicalOperatorId:"u1",occurredAt:now},
  ]);
  expect(s.representedUsers).toBe(1); expect(s.causalLearningYield).toBe(1); expect(s.evidenceFlywheel.causalEstimates).toBe(1);
 });
});
