import { describe, expect, it } from "vitest";
import { buildBldgIntakeOrder } from "./residentIntake";

describe("buildBldgIntakeOrder", () => {
  it("builds an actionable HELD order when structured timing is complete", () => {
    const result = buildBldgIntakeOrder(
      {
        source: "resident_app",
        resident: {
          name: "Adam Wright",
          phone: "(323) 807-4661",
          buildingId: "opus-la",
          unit: "1208",
        },
        service: {
          type: "laundry",
          pickupDate: "2026-06-04",
          pickupWindow: "morning",
          returnBy: "2026-06-06T10:00:00-07:00",
          notes: "Return by Friday morning.",
        },
        held: {
          rawRequestText: "Can you pick up my laundry tomorrow morning and make sure it is back by Friday morning?",
          cleanedRequestText: "Pick up laundry tomorrow morning and return by Friday morning.",
          displayRequest: "Pick up laundry tomorrow morning and return by Friday morning.",
          confidence: 0.92,
          metadata: { planId: "held_1" },
        },
        payment: {
          stripeCustomerId: "cus_123",
          stripePaymentMethodId: "pm_123",
        },
      },
      "default"
    );

    expect(result.needsReview).toBe(false);
    expect(result.status).toBe("new");
    expect(result.order).toMatchObject({
      serviceType: "wash_fold",
      pickupDate: "2026-06-04",
      pickupTimeWindow: "morning",
      deliveryDate: "2026-06-06",
      deliveryTimeWindow: "2026-06-06T10:00:00-07:00",
      firstName: "Adam",
      lastName: "Wright",
      phone: "+13238074661",
      buildingSlug: "opusla",
      unit: "1208",
      status: "new",
      heldSource: "resident_app",
      heldRawRequestText: "Can you pick up my laundry tomorrow morning and make sure it is back by Friday morning?",
      heldCleanedRequestText: "Pick up laundry tomorrow morning and return by Friday morning.",
      heldRequestedPickupWindow: "morning",
      heldRequestedReturnBy: "2026-06-06T10:00:00-07:00",
    });
  });

  it("keeps incomplete HELD timing in review instead of scheduling it", () => {
    const result = buildBldgIntakeOrder(
      {
        source: "resident_app",
        resident: {
          name: "Ada Lovelace",
          phone: "+13238074661",
          buildingId: "opus_la",
          unit: "904",
        },
        service: {
          type: "laundry",
          pickupWindow: "tomorrow morning",
          returnBy: "Friday",
        },
        held: {
          rawRequestText: "Pickup laundry tomorrow morning and return by Friday.",
          cleanedRequestText: "Pick up laundry tomorrow morning and return by Friday.",
          metadata: { conversationId: "conv_1" },
        },
      },
      "default"
    );

    expect(result.needsReview).toBe(true);
    expect(result.status).toBe("intake-pending");
    expect(result.order.status).toBe("intake-pending");
    expect(result.order.pickupDate).toBe("TBD");
    expect(result.order.pickupTimeWindow).toBe("tomorrow morning");
    expect(result.order.deliveryDate).toBeNull();
    expect(result.order.heldRawRequestText).toBe("Pickup laundry tomorrow morning and return by Friday.");
    expect(result.order.heldCleanedRequestText).toBe("Pick up laundry tomorrow morning and return by Friday.");
    expect(result.order.heldRequestedReturnBy).toBe("Friday");
  });
});
