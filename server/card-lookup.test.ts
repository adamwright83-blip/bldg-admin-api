import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { findStripeCardByPhone, createOrder, updateOrderStripe } from "./db";

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("findStripeCardByPhone", () => {
  it("returns null when no orders have Stripe IDs for the phone", async () => {
    const result = await findStripeCardByPhone("9999999999");
    expect(result).toBeNull();
  });

  it("finds Stripe card from a sibling order with the same phone", async () => {
    // Create an order with a unique phone and attach Stripe IDs
    const testPhone = `test-${Date.now()}`;
    const orderId = await createOrder({
      tenantId: "default",
      serviceType: "wash_fold",
      pickupDate: "2026-03-01",
      pickupTimeWindow: "7:00am–9:00am",
      deliveryDate: "2026-03-02",
      deliveryTimeWindow: "7:00am–9:00am",
      address: "123 Test St",
      unit: null,
      specialInstructions: null,
      firstName: "CardTest",
      lastName: "User",
      phone: testPhone,
      email: null,
      status: "new",
    });

    await updateOrderStripe(orderId, "cus_test_123", "pm_test_456");

    // Now look up by phone — should find the card
    const card = await findStripeCardByPhone(testPhone);
    expect(card).not.toBeNull();
    expect(card!.stripeCustomerId).toBe("cus_test_123");
    expect(card!.stripePaymentMethodId).toBe("pm_test_456");
  });

  it("returns null when Stripe IDs are empty strings", async () => {
    const testPhone = `test-empty-${Date.now()}`;
    const orderId = await createOrder({
      tenantId: "default",
      serviceType: "wash_fold",
      pickupDate: "2026-03-01",
      pickupTimeWindow: "7:00am–9:00am",
      deliveryDate: "2026-03-02",
      deliveryTimeWindow: "7:00am–9:00am",
      address: "123 Test St",
      unit: null,
      specialInstructions: null,
      firstName: "EmptyCard",
      lastName: "User",
      phone: testPhone,
      email: null,
      status: "new",
    });

    // Set customer ID but empty payment method (like createSetupIntent does initially)
    await updateOrderStripe(orderId, "cus_test_empty", "");

    const card = await findStripeCardByPhone(testPhone);
    expect(card).toBeNull();
  });
});
