import { describe, expect, it } from "vitest";
import { assertDaphneAgentScope } from "./privacy";
describe("Daphne V2 privacy and scope",()=>{
 it("denies cross-agent relationship access by default",()=>expect(()=>assertDaphneAgentScope({requestedAgentId:"mitch",relationshipAgentId:"claire",crossAgentSharingEnabled:false})).toThrow(/denied/));
 it("allows it only with explicit sharing permission",()=>expect(()=>assertDaphneAgentScope({requestedAgentId:"mitch",relationshipAgentId:"claire",crossAgentSharingEnabled:true})).not.toThrow());
});
