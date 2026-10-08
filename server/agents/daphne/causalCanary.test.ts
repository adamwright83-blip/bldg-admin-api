import { describe, expect, it } from "vitest";
import { planDaphneProductionCanary } from "./causalCanary";
const pref=(value:boolean)=>({id:"p",tenantId:"t",canonicalOperatorId:"o",preferenceKey:"safe_experimentation" as const,value,version:1,sourceObservationId:"obs",status:"active" as const,createdAt:"x"});
describe("Daphne V2 production causal canary",()=>{
 it("is off by default even when experimentation preference is true",()=>expect(planDaphneProductionCanary({tenantId:"t",preferences:{safe_experimentation:pref(true)},actions:[],env:{}}).status).toBe("disabled"));
 it("requires explicit user experimentation permission",()=>expect(planDaphneProductionCanary({tenantId:"t",preferences:{safe_experimentation:pref(false)},actions:[],env:{DAPHNE_V2_CAUSAL_CANARY_ENABLED:"true"}}).reason).toBe("user_experimentation_not_enabled"));
});
