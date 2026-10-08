import { describe, expect, it } from "vitest";
import { attributeDaphneAgentChange } from "./agentChangeAttribution";
describe("Daphne V2 agent-caused change attribution",()=>{
 it("does not call sequence causation",()=>expect(attributeDaphneAgentChange({interventionId:"i",changeKey:"started",interventionOccurredAt:"2026-10-07T00:00:00Z",changeObservedAt:"2026-10-07T00:01:00Z",linkedOutcome:true,associationObserved:true,evidenceRefs:["o"]}).causalClaimAllowed).toBe(false));
 it("allows bounded causal language only with a supported effect estimate",()=>expect(attributeDaphneAgentChange({interventionId:"i",changeKey:"started",interventionOccurredAt:"2026-10-07T00:00:00Z",changeObservedAt:"2026-10-07T00:01:00Z",linkedOutcome:true,treatmentEffectStatus:"randomized",evidenceRefs:["o","effect"]}).relation).toBe("causal_supported"));
});
