import { describe, it, expect, beforeAll } from "vitest";
import { createOrder, deleteOrder, getOrderById } from "./db";

describe("Delete Order", () => {
  let testOrderId: number;

  beforeAll(async () => {
    // Create a test order to delete
    testOrderId = await createOrder({
      tenantId: "default",
      serviceType: "wash_fold",
      pickupDate: "2026-02-20",
      pickupTimeWindow: "7:00am–9:00am",
      deliveryDate: "2026-02-21",
      deliveryTimeWindow: "7:00am–9:00am",
      address: "123 Test St, Los Angeles, CA 90001",
      unit: "101",
      specialInstructions: "Test order for deletion",
      firstName: "Test",
      lastName: "User",
      phone: "+13235551111",
      email: "test@example.com",
      stripeCustomerId: null,
      stripePaymentMethodId: null,
      status: "collected",
    });
  });

  it("should delete an order successfully", async () => {
    // Verify order exists before deletion
    const orderBefore = await getOrderById(testOrderId);
    expect(orderBefore).toBeDefined();
    expect(orderBefore?.id).toBe(testOrderId);

    // Delete the order
    await deleteOrder(testOrderId);

    // Verify order no longer exists
    const orderAfter = await getOrderById(testOrderId);
    expect(orderAfter).toBeUndefined();
  });

  it("should not throw error when deleting non-existent order", async () => {
    // Deleting a non-existent order should not throw
    await expect(deleteOrder(999999)).resolves.not.toThrow();
  });
});
