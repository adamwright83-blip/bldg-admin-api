import { describe, it, expect, beforeAll } from "vitest";
import { createOrder } from "./db";

describe("Receipt API", () => {
  let testOrderId: number = 999999; // Use a known non-existent ID for testing auth

  // Skip order creation for auth tests - just test the endpoint security

  it("should reject requests without APP_SHARED_API_SECRET", async () => {
    const response = await fetch(
      `http://localhost:3000/api/orders/${testOrderId}/receipt`
    );
    expect(response.status).toBe(401);
  });

  it("should reject requests with invalid APP_SHARED_API_SECRET", async () => {
    const response = await fetch(
      `http://localhost:3000/api/orders/${testOrderId}/receipt`,
      {
        headers: {
          "X-APP-SHARED-SECRET": "wrong-secret",
        },
      }
    );
    expect(response.status).toBe(401);
  });

  it("should accept requests with valid APP_SHARED_API_SECRET", async () => {
    const response = await fetch(
      `http://localhost:3000/api/orders/${testOrderId.toString()}/receipt`,
      {
        headers: {
          "X-APP-SHARED-SECRET": process.env.APP_SHARED_API_SECRET || "",
        },
      }
    );
    
    // Order doesn't exist, so should return 404
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Order not found");
  });
});
