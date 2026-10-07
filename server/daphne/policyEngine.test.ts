import { describe, expect, it } from "vitest";
import { chooseDaphnePolicyAction } from "./policyEngine";
describe("Daphne V2 multi-objective policy",()=>{
 it("can prefer lower burden/trust risk rather than maximizing starts alone",()=>{
  const d=chooseDaphnePolicyAction({policyVersion:"v2",candidates:[
   {key:"pressure",proximal:1,distal:.5,burden:1,relationshipRisk:1,preferenceFit:.2,uncertainty:.1},
   {key:"brief",proximal:.8,distal:.8,burden:.1,relationshipRisk:.1,preferenceFit:.9,uncertainty:.1},
  ]}); expect(d.action).toBe("brief");
 });
 it("hard-blocks unsafe actions",()=>expect(chooseDaphnePolicyAction({policyVersion:"v2",candidates:[{key:"unsafe",proximal:1,distal:1,burden:0,relationshipRisk:0,preferenceFit:1,uncertainty:0,hardBlocked:true}]}).abstained).toBe(true));
});
