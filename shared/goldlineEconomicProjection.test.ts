import { describe, expect, it } from "vitest";
import { currentEconomicRevenueCents, latestEconomicSnapshots } from "./goldlineEconomicProjection";
import type { GoldlineWorldEvent } from "./goldlineWorld";

const event = (revision: number, cents: number, physicalEntityId: string | null = "cpe") => ({
  id: `revision-${revision}`, tenantId: "tenant", eventType: revision === 1 ? "order_paid" : "order_payment_corrected",
  classification: "outcome", provenanceClass: "existing_business_record", physicalEntityId,
  metadata: { economicKey: "one-order", revision, paid: true, amountCents: cents, paymentAt: "2026-09-03T07:00:00Z" },
}) as GoldlineWorldEvent;

describe("economic replacement projection", () => {
  it("corrects revenue without a second grant regardless of delivery order", () => {
    const events = [event(2, 13410), event(1, 5000), event(2, 13410)];
    expect(latestEconomicSnapshots(events)).toHaveLength(1);
    expect(currentEconomicRevenueCents(events)).toBe(13410);
  });
  it("moves association without attributing unresolved money", () => {
    expect(currentEconomicRevenueCents([event(1, 5000), event(2, 5000, null)], "cpe")).toBe(0);
    expect(currentEconomicRevenueCents([event(1, 5000), event(2, 5000, "opus")], "opus")).toBe(5000);
  });
  it("revokes voided or undated corrections and rejects game fiction", () => {
    const correction = event(2, 5000);
    correction.metadata.paid = false;
    expect(currentEconomicRevenueCents([event(1, 5000), correction])).toBe(0);
    correction.metadata.paid = true;
    correction.metadata.paymentAt = null;
    expect(currentEconomicRevenueCents([event(1, 5000), correction])).toBe(0);
    const fiction = event(1, 9000);
    fiction.provenanceClass = "generated_game_fiction";
    expect(currentEconomicRevenueCents([fiction])).toBe(0);
  });
});
