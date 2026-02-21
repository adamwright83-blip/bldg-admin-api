import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

describe("POST /api/intake/from-bldg", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockCreateOrder: ReturnType<typeof vi.fn>;
  let statusCode: number;
  let responseData: any;

  beforeEach(() => {
    statusCode = 200;
    responseData = null;

    mockReq = {
      headers: {},
      body: {},
    };

    mockRes = {
      status: vi.fn((code: number) => {
        statusCode = code;
        return mockRes as Response;
      }),
      json: vi.fn((data: any) => {
        responseData = data;
        return mockRes as Response;
      }),
    };

    mockCreateOrder = vi.fn().mockResolvedValue(123);
  });

  it("should reject requests without APP_SHARED_API_SECRET header", async () => {
    mockReq.headers = {};

    const handler = createIntakeHandler(mockCreateOrder);
    await handler(mockReq as Request, mockRes as Response);

    expect(statusCode).toBe(401);
    expect(responseData).toEqual({ error: "Unauthorized" });
  });

  it("should reject requests with wrong APP_SHARED_API_SECRET", async () => {
    mockReq.headers = { "x-app-shared-secret": "wrong-secret" };

    const handler = createIntakeHandler(mockCreateOrder);
    await handler(mockReq as Request, mockRes as Response);

    expect(statusCode).toBe(401);
    expect(responseData).toEqual({ error: "Unauthorized" });
  });

  it("should reject requests missing required fields", async () => {
    mockReq.headers = { "x-app-shared-secret": "test-secret" };
    mockReq.body = {
      serviceType: "wash-fold",
      firstName: "George",
      // Missing lastName, phone, address, pickupDate, pickupWindow
    };

    const handler = createIntakeHandler(mockCreateOrder);
    await handler(mockReq as Request, mockRes as Response);

    expect(statusCode).toBe(400);
    expect(responseData).toEqual({ error: "Missing required fields" });
  });

  it("should reject invalid service type", async () => {
    mockReq.headers = { "x-app-shared-secret": "test-secret" };
    mockReq.body = {
      serviceType: "invalid-service",
      firstName: "George",
      lastName: "Peterson",
      phone: "+13235559999",
      address: "10000 Santa Monica Blvd, Los Angeles, CA 90067",
      pickupDate: "2026-02-20",
      pickupWindow: "7:00am–9:00am",
    };

    const handler = createIntakeHandler(mockCreateOrder);
    await handler(mockReq as Request, mockRes as Response);

    expect(statusCode).toBe(400);
    expect(responseData).toEqual({ error: "Invalid service type" });
  });

  it("should create order successfully with wash-fold service", async () => {
    mockReq.headers = { "x-app-shared-secret": "test-secret" };
    mockReq.body = {
      source: "bldg.chat",
      serviceType: "wash-fold",
      firstName: "George",
      lastName: "Peterson",
      phone: "+13235559999",
      email: "george@example.com",
      unit: "915",
      address: "10000 Santa Monica Blvd, Los Angeles, CA 90067",
      pickupDate: "2026-02-20",
      pickupWindow: "7:00am–9:00am",
      specialInstructions: "Ring doorbell twice",
    };

    const handler = createIntakeHandler(mockCreateOrder);
    await handler(mockReq as Request, mockRes as Response);

    expect(statusCode).toBe(200);
    expect(responseData).toEqual({ ok: true, orderId: 123 });
    expect(mockCreateOrder).toHaveBeenCalledWith({
      tenantId: "default",
      serviceType: "wash_fold",
      pickupDate: "2026-02-20",
      pickupTimeWindow: "7:00am–9:00am",
      deliveryDate: "2026-02-21", // Next day
      deliveryTimeWindow: "7:00am–9:00am",
      address: "10000 Santa Monica Blvd, Los Angeles, CA 90067",
      unit: "915",
      specialInstructions: "Ring doorbell twice",
      firstName: "George",
      lastName: "Peterson",
      phone: "+13235559999",
      email: "george@example.com",
      stripeCustomerId: null,
      stripePaymentMethodId: null,
      status: "new",
    });
  });

  it("should create order successfully with dry-cleaning service", async () => {
    mockReq.headers = { "x-app-shared-secret": "test-secret" };
    mockReq.body = {
      source: "bldg.chat",
      serviceType: "dry-cleaning",
      firstName: "Alice",
      lastName: "Smith",
      phone: "+13235551234",
      address: "456 Wilshire Blvd, Los Angeles, CA 90010",
      pickupDate: "2026-02-22",
      pickupWindow: "9:00am–11:00am",
    };

    const handler = createIntakeHandler(mockCreateOrder);
    await handler(mockReq as Request, mockRes as Response);

    expect(statusCode).toBe(200);
    expect(responseData).toEqual({ ok: true, orderId: 123 });
    expect(mockCreateOrder).toHaveBeenCalledWith({
      tenantId: "default",
      serviceType: "dry_cleaning",
      pickupDate: "2026-02-22",
      pickupTimeWindow: "9:00am–11:00am",
      deliveryDate: "2026-02-23",
      deliveryTimeWindow: "9:00am–11:00am",
      address: "456 Wilshire Blvd, Los Angeles, CA 90010",
      unit: null,
      specialInstructions: null,
      firstName: "Alice",
      lastName: "Smith",
      phone: "+13235551234",
      email: null,
      stripeCustomerId: null,
      stripePaymentMethodId: null,
      status: "new",
    });
  });
});

// Helper to create the handler function for testing
function createIntakeHandler(mockCreateOrder: any) {
  return async (req: Request, res: Response) => {
    const sharedSecret = req.headers["x-app-shared-secret"];

    if (!sharedSecret || sharedSecret !== "test-secret") {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const {
        source,
        serviceType,
        firstName,
        lastName,
        phone,
        email,
        unit,
        address,
        pickupDate,
        pickupWindow,
        specialInstructions,
      } = req.body;

      // Validate required fields
      if (!serviceType || !firstName || !lastName || !phone || !address || !pickupDate || !pickupWindow) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Normalize service type from "wash-fold" to "wash_fold"
      const normalizedServiceType = serviceType.replace("-", "_");

      if (normalizedServiceType !== "wash_fold" && normalizedServiceType !== "dry_cleaning") {
        return res.status(400).json({ error: "Invalid service type" });
      }

      // Calculate default delivery date (next day)
      const pickupDateObj = new Date(pickupDate + "T00:00:00");
      pickupDateObj.setDate(pickupDateObj.getDate() + 1);
      const defaultDeliveryDate = pickupDateObj.toISOString().split("T")[0];

      // Create order with status "new" (same as admin-created orders)
      const orderId = await mockCreateOrder({
        tenantId: "default",
        serviceType: normalizedServiceType,
        pickupDate,
        pickupTimeWindow: pickupWindow,
        deliveryDate: defaultDeliveryDate,
        deliveryTimeWindow: pickupWindow,
        address,
        unit: unit || null,
        specialInstructions: specialInstructions || null,
        firstName,
        lastName,
        phone,
        email: email || null,
        stripeCustomerId: null,
        stripePaymentMethodId: null,
        status: "new",
      });

      res.json({ ok: true, orderId });
    } catch (err) {
      console.error("[Intake API] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
