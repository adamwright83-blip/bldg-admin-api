import { describe, expect, it } from "vitest";
import type { Order } from "@shared/types";
import { buildDriverMissionStops } from "../driverMissionModel";

function order(overrides: Partial<Order> = {}): Order {
  const now = new Date("2026-06-05T16:00:00.000Z");
  return {
    id: 1,
    tenantId: "default",
    serviceType: "wash_fold",
    pickupDate: "2026-06-04",
    pickupTimeWindow: "7-10 AM",
    deliveryDate: "2026-06-09",
    deliveryTimeWindow: "5-7 PM",
    address: "3545 Wilshire Blvd",
    unit: "1201",
    specialInstructions: null,
    heldRawRequestText: null,
    heldCleanedRequestText: null,
    heldServiceSummary: null,
    heldRequestedPickupWindow: null,
    heldRequestedReturnBy: null,
    heldSource: null,
    heldMetadataJson: null,
    firstName: "Lila",
    lastName: "Barkhordarian",
    phone: "3235550101",
    email: null,
    bldgUserId: null,
    stripeCustomerId: null,
    stripePaymentMethodId: null,
    stripePaymentIntentId: null,
    status: "ready",
    weightLbs: null,
    bagCount: 1,
    garmentCount: null,
    subtotal: "0",
    discountPercent: "0",
    total: "0",
    upchargesJson: null,
    drycleanItemsJson: null,
    paid: false,
    paidAt: null,
    isFirstPaidOrder: false,
    portalJwt: null,
    buildingSlug: "opusla",
    vendorId: null,
    vendorNameSnapshot: null,
    routingPrioritySnapshot: null,
    platformFeeCents: null,
    vendorPayoutCents: null,
    stripeConnectedAccountIdSnapshot: null,
    manualRiskFlag: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("driver mission model", () => {
  it("uses actual delivery date and delivery window for delivery stops", () => {
    const stops = buildDriverMissionStops([], [order()]);
    expect(stops[0]).toMatchObject({
      stage: "delivery",
      dateLabel: "Tue, Jun 9",
      timeWindow: "5-7 PM",
    });
  });

  it("labels missing delivery dates as estimated fallbacks", () => {
    const stops = buildDriverMissionStops([], [order({ deliveryDate: null, deliveryTimeWindow: null })]);
    expect(stops[0].dateLabel).toBe("Est. Fri, Jun 5");
    expect(stops[0].timeWindow).toBe("window n/a");
  });
});
