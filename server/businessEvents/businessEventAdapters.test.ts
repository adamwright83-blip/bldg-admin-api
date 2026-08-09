import { describe, expect, it } from "vitest";
import { dedupeBusinessEvents } from "../../shared/businessGame";
import { missionEventToBusinessEvent, orderPaymentEventToBusinessEvent } from "./businessEventAdapters";

describe("business event adapters", () => {
  it("preserves source entity, occurrence time, and provider verification", () => {
    const occurredAt = new Date("2026-08-08T18:00:00.000Z");
    const result = orderPaymentEventToBusinessEvent({
      id: "evt-1", tenantId: "tenant-a", orderId: 42, provider: "stripe",
      providerEventId: "pi.succeeded.1", eventType: "payment_succeeded", occurredAt,
      requestId: "request-1", createdAt: occurredAt, netPaidCents: 94000,
    });
    expect(result.entityId).toBe("42");
    expect(result.occurredAt).toBe(occurredAt.toISOString());
    expect(result.verificationClass).toBe("VERIFIED");
    expect(result.payload.netPaidCents).toBe(94000);
  });

  it("classifies operator mission transitions as attested", () => {
    const result = missionEventToBusinessEvent({
      id: 9, tenantId: "tenant-a", missionId: 3, eventName: "mission_arrived",
      actorType: "driver", actorId: "driver-1", idempotencyKey: "arrive-1",
      createdAt: new Date("2026-08-08T18:00:00.000Z"),
    });
    expect(result.verificationClass).toBe("ATTESTED");
    expect(result.actorType).toBe("field");
  });

  it("does not produce duplicate deltas for the same tenant dedupe key", () => {
    const base = missionEventToBusinessEvent({
      id: 9, tenantId: "tenant-a", missionId: 3, eventName: "mission_arrived",
      actorType: "system", idempotencyKey: "arrive-1", createdAt: new Date(),
    });
    expect(dedupeBusinessEvents([base, { ...base, id: "mission:10" }])).toHaveLength(1);
    expect(dedupeBusinessEvents([base, { ...base, tenantId: "tenant-b" }])).toHaveLength(2);
  });
});
