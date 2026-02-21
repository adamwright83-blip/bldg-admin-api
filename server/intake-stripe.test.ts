import { describe, it, expect } from "vitest";

const API_SECRET = process.env.APP_SHARED_API_SECRET || "laundry-app-shared-secret-2026";
const BASE_URL = "http://localhost:3000";
const fetch = globalThis.fetch;

describe("POST /api/intake/from-bldg with Stripe IDs", () => {
  it("should create order with Stripe customer and payment method IDs", async () => {
    // Skip if server not running
    if (!process.env.CI) return;
    const response = await fetch(`${BASE_URL}/api/intake/from-bldg`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-app-shared-secret": API_SECRET,
      },
      body: JSON.stringify({
        serviceType: "wash-fold",
        firstName: "Test",
        lastName: "StripeCard",
        phone: "+1234567890",
        address: "123 Main St",
        pickupDate: "2026-02-20",
        pickupWindow: "7:00am-9:00am",
        stripeCustomerId: "cus_test123",
        stripePaymentMethodId: "pm_test456",
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.orderId).toBeDefined();
    expect(typeof data.orderId).toBe("number");
  });

  it("should reject request without auth header", async () => {
    // Skip if server not running
    if (!process.env.CI) return;
    const response = await fetch(`${BASE_URL}/api/intake/from-bldg`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        serviceType: "wash-fold",
        firstName: "Test",
        lastName: "NoAuth",
        phone: "+1234567891",
        address: "456 Oak Ave",
        pickupDate: "2026-02-20",
        pickupWindow: "7:00am-9:00am",
      }),
    });

    expect(response.status).toBe(401);
  });

  it("should work without Stripe IDs (backward compatible)", async () => {
    // Skip if server not running
    if (!process.env.CI) return;
    const response = await fetch(`${BASE_URL}/api/intake/from-bldg`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-app-shared-secret": API_SECRET,
      },
      body: JSON.stringify({
        serviceType: "wash-fold",
        firstName: "Test",
        lastName: "NoStripe",
        phone: "+1234567892",
        address: "789 Pine Rd",
        pickupDate: "2026-02-20",
        pickupWindow: "7:00am-9:00am",
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
  });
});
