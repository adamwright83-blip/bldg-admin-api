import { describe, expect, it } from "vitest";
import { commercialWalkInMissionInput } from "./commercialWalkInService";

describe("commercial walk-in mapping", () => {
  it("preserves complete contact truth and leaves value unknown", () => {
    const mapped = commercialWalkInMissionInput({
      tenantId: "tenant-a", actorId: "adam", idempotencyKey: "walk-in-retry-key",
      requestId: "11111111-1111-4111-8111-111111111111", businessName: "Maybourne Beverly Hills",
      businessType: "luxury_hotel", address: "225 N Canon Dr", contactName: "Vincent",
      contactTitle: "Concierge", contactEmail: "vincent@example.com", contactPhone: "+1 310 555 0100",
      relationshipType: "concierge", conversationNotes: "Asked about turnaround",
      visitResult: "follow_up", nextAction: "Email turnaround details tomorrow",
      followUpAt: new Date("2026-07-25T17:00:00Z"),
    });
    expect(mapped.account.decisionMaker).toMatchObject({
      name: "Vincent", title: "Concierge", email: "vincent@example.com",
      phone: "+1 310 555 0100", relationshipType: "concierge",
    });
    expect(mapped.opportunity.estimatedAnnualValueCents).toBeNull();
    expect(mapped.actor.type).toBe("operator");
  });
});
