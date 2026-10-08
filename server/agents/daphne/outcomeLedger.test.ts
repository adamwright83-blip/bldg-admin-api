import { describe, expect, it } from "vitest";
import { validateDaphneOutcome } from "./outcomeLedger";
const base={tenantId:"t",canonicalOperatorId:"o",interventionId:"i",outcomeClass:"distal" as const,measureKey:"business:revenue",
 value:100,evidenceClass:"authoritative_external" as const,verificationStatus:"verified" as const,sourceReference:"receipt:1",observedAt:"2026-10-07T00:00:00Z",idempotencyKey:"x"};
describe("Daphne V2 OutcomeLedger",()=>{
 it("refuses attested business truth",()=>expect(()=>validateDaphneOutcome({...base,evidenceClass:"operator_attested",verificationStatus:"attested"})).toThrow(/business outcomes/));
 it("accepts referenced verified business evidence",()=>expect(()=>validateDaphneOutcome(base)).not.toThrow());
 it("rejects inverted outcome windows",()=>expect(()=>validateDaphneOutcome({...base,windowStart:"2026-10-08",windowEnd:"2026-10-07"})).toThrow(/cannot precede/));
});
