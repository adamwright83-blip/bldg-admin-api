import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

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

describe("orders.create", () => {
  it("creates an order and returns an orderId", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.orders.create({
      serviceType: "wash_fold",
      pickupDate: "2026-02-15",
      pickupTimeWindow: "7:00am – 1:00pm",
      address: "123 Wilshire Blvd, Los Angeles, CA 90010",
      unit: "Unit 2401",
      specialInstructions: "Leave with concierge",
      firstName: "John",
      lastName: "Doe",
      phone: "(310) 555-0100",
      email: "john@example.com",
    });

    expect(result).toHaveProperty("orderId");
    expect(typeof result.orderId).toBe("number");
    expect(result.orderId).toBeGreaterThan(0);
  });

  it("creates an order without optional fields", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.orders.create({
      serviceType: "dry_cleaning",
      pickupDate: "2026-02-16",
      pickupTimeWindow: "7:00pm – 9:00pm",
      address: "456 Sunset Blvd, Los Angeles, CA",
      firstName: "Jane",
      lastName: "Smith",
      phone: "(323) 555-0200",
    });

    expect(result).toHaveProperty("orderId");
    expect(typeof result.orderId).toBe("number");
    expect(result.orderId).toBeGreaterThan(0);
  });

  it("rejects an order with missing required fields", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.orders.create({
        serviceType: "wash_fold",
        pickupDate: "2026-02-15",
        pickupTimeWindow: "7:00am – 1:00pm",
        address: "", // empty address should fail
        firstName: "John",
        lastName: "Doe",
        phone: "(310) 555-0100",
      })
    ).rejects.toThrow();
  });
});
