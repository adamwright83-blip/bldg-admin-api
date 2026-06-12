import { describe, expect, it } from "vitest";
import { buildBldgIntakeOrder } from "./residentIntake";

// Live regression (order #173, 2026-06-12): the resident payload carried a
// return-by DATE but no delivery time window, and the date string leaked into
// orders.deliveryTimeWindow ("2026-06-14"). A *TimeWindow column must never
// hold a date.
const BASE_BODY = {
  source: "bldg-resident",
  serviceType: "wash_fold",
  firstName: "Test",
  lastName: "Resident",
  phone: "+13105550123",
  address: "100 Test Ave",
  pickupDate: "2026-06-12",
  pickupWindow: "7–9 AM",
};

describe("buildBldgIntakeOrder — delivery window can never be a date", () => {
  it("REGRESSION #173: deliveryDate-only payload does not leak the date into deliveryTimeWindow", () => {
    const built = buildBldgIntakeOrder(
      { ...BASE_BODY, deliveryDate: "2026-06-14" },
      "default",
    );
    expect(built.order.deliveryTimeWindow).not.toBe("2026-06-14");
    expect(built.order.deliveryTimeWindow ?? "").not.toMatch(/^\d{4}-\d{2}-\d{2}/);
    // the date itself still lands where it belongs
    expect(built.order.deliveryDate).toBe("2026-06-14");
  });

  it("a real delivery window passes through untouched", () => {
    const built = buildBldgIntakeOrder(
      { ...BASE_BODY, deliveryDate: "2026-06-12", deliveryTimeWindow: "7–9 PM" },
      "default",
    );
    expect(built.order.deliveryTimeWindow).toBe("7–9 PM");
    expect(built.order.deliveryDate).toBe("2026-06-12");
  });

  it("clientRequestId flows to the physical column and the metadata mirror", () => {
    const built = buildBldgIntakeOrder(
      { ...BASE_BODY, clientRequestId: "held_tap_abc123" },
      "default",
    );
    expect(built.clientRequestId).toBe("held_tap_abc123");
    expect(built.order.residentClientRequestId).toBe("held_tap_abc123");
    const meta = built.order.heldMetadataJson as Record<string, unknown> | null;
    expect(meta?.clientRequestId).toBe("held_tap_abc123");
  });
});
