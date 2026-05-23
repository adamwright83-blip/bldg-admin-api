import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Order } from "../drizzle/schema";
import {
  buildOperationEventForOrderStatusChange,
  buildPickupCompletedOperationsEventForOrder,
  shouldCaptureOperationEvent,
} from "./operationsEvents";

function order(overrides: Partial<Order> = {}): Order {
  const now = new Date("2026-05-14T18:30:00.000Z");
  return {
    id: 42,
    tenantId: "laundry_farm",
    serviceType: "wash_fold",
    pickupDate: "2026-05-14",
    pickupTimeWindow: "10:00am-12:00pm",
    deliveryDate: "2026-05-15",
    deliveryTimeWindow: "5:00pm-7:00pm",
    address: "3545 Wilshire Blvd, Los Angeles, CA 90010",
    unit: "1201",
    specialInstructions: null,
    firstName: "Moj",
    lastName: "Salon",
    phone: "3235550101",
    email: "moj@example.com",
    bldgUserId: null,
    stripeCustomerId: null,
    stripePaymentMethodId: null,
    stripePaymentIntentId: null,
    status: "new",
    weightLbs: "12.50",
    bagCount: 2,
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

describe("operations event capture", () => {
  it("captures forward pickup and dropoff transitions only", () => {
    expect(shouldCaptureOperationEvent({ previousStatus: "new", nextStatus: "collected" })).toBe(true);
    expect(shouldCaptureOperationEvent({ previousStatus: "ready", nextStatus: "delivered" })).toBe(true);
    expect(shouldCaptureOperationEvent({ previousStatus: "new", nextStatus: "delivered" })).toBe(true);
    expect(shouldCaptureOperationEvent({ previousStatus: "delivered", nextStatus: "collected" })).toBe(false);
    expect(shouldCaptureOperationEvent({ previousStatus: "collected", nextStatus: "new" })).toBe(false);
    expect(shouldCaptureOperationEvent({ previousStatus: "collected", nextStatus: "processing" })).toBe(false);
  });

  it("builds a pickup event with scheduled pickup window and actual timestamp", () => {
    const actual = new Date("2026-05-14T20:15:00.000Z");
    const event = buildOperationEventForOrderStatusChange({
      order: order(),
      previousStatus: "new",
      nextStatus: "collected",
      actor: {
        actorUserId: 7,
        actorDisplayName: "Adam",
        actualEventTimestamp: actual,
      },
    });

    expect(event).toMatchObject({
      tenantId: "laundry_farm",
      businessUnitLabel: "Laundry Farm",
      source: "driver_app_bldg",
      sourceEventType: "pickup_completed",
      eventStatus: "completed",
      orderId: 42,
      customerName: "Moj Salon",
      buildingName: "Opus Los Angeles",
      buildingSlug: "opusla",
      tower: "South Tower",
      buildingResolutionStatus: "resolved",
      scheduledDate: "2026-05-14",
      scheduledWindow: "10:00am-12:00pm",
      actualEventTimestamp: actual,
      actorUserId: "7",
      actorDisplayName: "Adam",
      bagCount: 2,
      weightLbs: "12.50",
    });
    expect((event?.rawJson as any).orderSnapshot.firstName).toBe("Moj");
  });

  it("builds a dropoff event from delivery schedule without synthesizing pickup", () => {
    const event = buildOperationEventForOrderStatusChange({
      order: order({ status: "new" }),
      previousStatus: "new",
      nextStatus: "delivered",
      actor: { actualEventTimestamp: new Date("2026-05-15T01:00:00.000Z") },
    });

    expect(event).toMatchObject({
      sourceEventType: "dropoff_completed",
      scheduledDate: "2026-05-15",
      scheduledWindow: "5:00pm-7:00pm",
    });
  });

  it("uses a stable source, event type, and order id idempotency key", () => {
    const first = buildOperationEventForOrderStatusChange({
      order: order(),
      previousStatus: "new",
      nextStatus: "collected",
      actor: { actualEventTimestamp: new Date("2026-05-14T20:15:00.000Z") },
    });
    const retry = buildOperationEventForOrderStatusChange({
      order: order(),
      previousStatus: "new",
      nextStatus: "collected",
      actor: { actualEventTimestamp: new Date("2026-05-14T20:16:00.000Z") },
    });

    expect([first?.source, first?.sourceEventType, first?.orderId]).toEqual([
      retry?.source,
      retry?.sourceEventType,
      retry?.orderId,
    ]);
  });

  it("preserves vendor-initiated events with vendor id and nullable actor fields", () => {
    const event = buildOperationEventForOrderStatusChange({
      order: order({ vendorId: 12, tenantId: "default" }),
      previousStatus: "ready",
      nextStatus: "delivered",
    });

    expect(event).toMatchObject({
      tenantId: "default",
      businessUnitLabel: "Laundry Butler",
      vendorId: 12,
      actorUserId: null,
      actorDisplayName: null,
    });
    expect((event?.rawJson as any).vendorInitiated).toBe(true);
  });

  it("builds system pickup events for admin charge backfills", () => {
    const paidAt = new Date("2026-05-18T20:10:00.000Z");
    const event = buildPickupCompletedOperationsEventForOrder({
      order: order({ status: "processing", paid: true, paidAt }),
      actor: {
        actorDisplayName: "Admin charge",
        actualEventTimestamp: paidAt,
      },
      reason: "stripe_charge_succeeded",
    });

    expect(event).toMatchObject({
      source: "system_backfill",
      sourceEventType: "pickup_completed",
      eventStatus: "completed",
      orderId: 42,
      actorDisplayName: "Admin charge",
      actualEventTimestamp: paidAt,
      scheduledDate: "2026-05-14",
      scheduledWindow: "10:00am-12:00pm",
    });
    expect((event.rawJson as any).reason).toBe("stripe_charge_succeeded");
    expect((event.rawJson as any).synthesizedFrom).toBe("order_payment_truth");
  });

  it("flags unknown explicit building slugs as unresolved instead of fake-resolved", () => {
    const event = buildOperationEventForOrderStatusChange({
      order: order({
        buildingSlug: "unknown-condo",
        address: "999 Mystery Tower, Los Angeles, CA",
      }),
      previousStatus: "new",
      nextStatus: "collected",
    });

    expect(event).toMatchObject({
      buildingName: null,
      buildingSlug: "unknown-condo",
      tower: null,
      buildingResolutionStatus: "unresolved_needs_mapping",
    });
  });

  it("DB helpers avoid duplicate pickup events across sources", () => {
    const source = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
    expect(source).toContain("ensurePickupCompletedOperationsEventForOrder");
    expect(source).toContain("eq(operationsEvents.orderId, orderId), eq(operationsEvents.sourceEventType, \"pickup_completed\")");
    expect(source).toContain("eq(operationsEvents.orderId, orderId), eq(operationsEvents.sourceEventType, event.sourceEventType)");
  });
});
