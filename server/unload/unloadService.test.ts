import { describe, expect, it } from "vitest";
import { dedupeBusinessEvents } from "../../shared/businessGame";

describe("UNLOAD resolution invariants",()=>{
  it("dedupes a replayed durable event before producing world deltas",()=>{
    const event={id:"1",tenantId:"t",entityType:"order",entityId:"1",eventType:"payment",occurredAt:"2026-08-09T00:00:00Z",actorType:"provider" as const,actorId:null,source:"stripe",sourceReference:"evt:1",verificationClass:"VERIFIED" as const,confidence:"high" as const,idempotencyKey:"stripe:1",payload:{}};
    expect(dedupeBusinessEvents([event,{...event,id:"2"}])).toHaveLength(1);
  });
});
