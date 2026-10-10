import { describe, expect, it } from "vitest";
import { buildDaphneResponseModel } from "./responseModel";
import type { DaphneInterventionRecord } from "./interventionLedger";
import type { DaphneOutcomeRecord } from "./outcomeLedger";
const i: DaphneInterventionRecord={id:"i",tenantId:"t",canonicalOperatorId:"o",agentId:"c",decisionPointId:"d",contextKey:"execution",
 acceptableActions:["brief"],chosenAction:"brief",selectionMode:"manual",selectionProbability:null,propensity:null,policyVersion:"v",
 policyReceipt:null,interventionDefinitionVersion:null,proximalOutcomeWindowMinutes:10,sourceObservationIds:["obs"],idempotencyKey:"i",createdAt:"2026-10-07T00:00:00Z"};
const o: DaphneOutcomeRecord={id:"o",tenantId:"t",canonicalOperatorId:"o",interventionId:"i",outcomeClass:"proximal",measureKey:"started",value:1,
 evidenceClass:"system_record",verificationStatus:"verified",sourceReference:"s",windowStart:null,windowEnd:null,observedAt:"2026-10-07T00:01:00Z",idempotencyKey:"o",createdAt:"2026-10-07T00:01:00Z"};
describe("Daphne V2 ResponseModel",()=>{
 it.each(["disputed","rejected","attested"] as const)("excludes %s outcomes",verificationStatus=>{
  const [r]=buildDaphneResponseModel({interventions:[i],outcomes:[{...o,verificationStatus}],successMeasureKey:"started"});
  expect(r.n).toBe(0); expect(r.expectedProximalOutcome).toBeNull();
 });
 it("counts an intervention once even when its measurement is written twice",()=>{
  const [r]=buildDaphneResponseModel({interventions:[i],outcomes:[o,{...o,id:"repeat"}],successMeasureKey:"started"});
  expect(r.n).toBe(1); expect(r.sourceOutcomeIds).toEqual(["o","repeat"]);
 });
 it("abstains on conflicting measurements for the same decision",()=>{
  const [r]=buildDaphneResponseModel({interventions:[i],outcomes:[o,{...o,id:"conflict",value:0}],successMeasureKey:"started"});
  expect(r.n).toBe(0); expect(r.sourceOutcomeIds).toEqual([]);
 });
 it.each([
  {tenantId:"foreign"}, {canonicalOperatorId:"foreign"},
  {observedAt:"2026-10-06T00:00:00Z"}, {observedAt:"2026-10-07T00:11:00Z"},
  {outcomeClass:"distal" as const}, {evidenceClass:"operator_attested" as const},
 ])("rejects ineligible outcome %j",override=>{
  const [r]=buildDaphneResponseModel({interventions:[i],outcomes:[{...o,...override}],successMeasureKey:"started"});
  expect(r.n).toBe(0);
 });
 it("labels ordinary learned response estimates association_only",()=>{
  const [r]=buildDaphneResponseModel({interventions:[i],outcomes:[o],successMeasureKey:"started"});
  expect(r.epistemicStatus).toBe("association_only"); expect(r.expectedProximalOutcome).toBe(1);
 });
});
