import { describe, expect, it, vi } from "vitest";
import { orders } from "../../../drizzle/schema";
import {
  admitNativeStripePayment,
  prepareNativeStripePaymentTenant,
} from "./paymentAdmission";
import { getDb } from "../../db";

vi.mock("../../db", () => ({
  getDb: vi.fn(),
}));

describe("paymentAdmission authority", () => {
  it("rejects prepareNativeStripePaymentTenant when tenant is empty", async () => {
    vi.mocked(getDb).mockResolvedValueOnce({} as any);
    await expect(
      prepareNativeStripePaymentTenant({ tenantId: "", orderId: 101 })
    ).rejects.toThrow("Stripe payment admission requires tenantId");
  });

  it("rejects prepareNativeStripePaymentTenant when order is not found", async () => {
    const mockTx = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      for: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(getDb).mockResolvedValueOnce({
      transaction: vi.fn((cb: any) => cb(mockTx)),
    } as any);

    await expect(
      prepareNativeStripePaymentTenant({ tenantId: "tenant-a", orderId: 101 })
    ).rejects.toThrow("Tenant order not found for payment admission");
  });

  it("rejects prepareNativeStripePaymentTenant when tenant does not match order tenant", async () => {
    const mockTx = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      for: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 101, tenantId: "tenant-b" }]),
    };
    vi.mocked(getDb).mockResolvedValueOnce({
      transaction: vi.fn((cb: any) => cb(mockTx)),
    } as any);

    await expect(
      prepareNativeStripePaymentTenant({ tenantId: "tenant-a", orderId: 101 })
    ).rejects.toThrow("Tenant order not found for payment admission");
  });

  it("holds a historical null-tenant order without assigning default ownership", async () => {
    const mockTx = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      for: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 101, tenantId: null }]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };
    vi.mocked(getDb).mockResolvedValueOnce({
      transaction: vi.fn((cb: any) => cb(mockTx)),
    } as any);

    await expect(prepareNativeStripePaymentTenant({ tenantId: "default", orderId: 101 })).rejects.toThrow("tenant authority is unresolved");
    expect(mockTx.update).not.toHaveBeenCalled();
    expect(mockTx.set).not.toHaveBeenCalled();
  });

  it("rejects admitNativeStripePayment when tenantId or paymentIntentId is missing", async () => {
    vi.mocked(getDb).mockResolvedValueOnce({} as any);
    await expect(
      admitNativeStripePayment({
        tenantId: "",
        orderId: 101,
        paymentIntentId: "pi_123",
        paidAt: new Date(),
        orderPatch: {},
      })
    ).rejects.toThrow("Stripe payment admission requires tenantId");

    vi.mocked(getDb).mockResolvedValueOnce({} as any);
    await expect(
      admitNativeStripePayment({
        tenantId: "tenant-a",
        orderId: 101,
        paymentIntentId: "   ",
        paidAt: new Date(),
        orderPatch: {},
      })
    ).rejects.toThrow("Stripe payment admission requires PaymentIntent evidence");
  });

  it("rejects admitNativeStripePayment when order does not belong to the tenant", async () => {
    const mockTx = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      for: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(getDb).mockResolvedValueOnce({
      transaction: vi.fn((cb: any) => cb(mockTx)),
    } as any);

    await expect(
      admitNativeStripePayment({
        tenantId: "tenant-a",
        orderId: 101,
        paymentIntentId: "pi_123",
        paidAt: new Date(),
        orderPatch: {},
      })
    ).rejects.toThrow("Tenant order not found for payment admission");
  });

  it("admits valid Stripe payment atomically projecting payment fields and delegating status to Orders helper", async () => {
    const paidAt = new Date("2026-10-06T19:00:00.000Z");
    const admittedAt = new Date("2026-10-06T19:00:01.000Z");
    const mockTx = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      for: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValueOnce([{ id: 101, tenantId: "tenant-a", status: "new", paid: false, stripePaymentIntentId: null }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: "auth-101",
            tenantId: "tenant-a",
            claimType: "payment_verified",
            subjectType: "order",
            subjectId: "101",
            sourceType: "stripe_payment_intent",
            sourceRef: "pi_real_123",
            actorType: "system",
            actorId: "admin-user-1",
            evidenceClass: "authoritative_external",
            verificationClass: "VERIFIED",
            admissionPolicy: "native_stripe_payment_v1",
            occurredAt: paidAt,
            admittedAt,
            metadataJson: { orderId: 101 },
            idempotencyKey: "payment_verified:order:101:stripe_payment_intent:pi_real_123",
          },
        ]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      onDuplicateKeyUpdate: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };
    vi.mocked(getDb).mockResolvedValueOnce({
      transaction: vi.fn((cb: any) => cb(mockTx)),
    } as any);

    const receipt = await admitNativeStripePayment({
      tenantId: "tenant-a",
      orderId: 101,
      paymentIntentId: "pi_real_123",
      paidAt,
      orderPatch: {
        total: "45.00",
      },
      actorId: "admin-user-1",
    });

    expect(receipt.claimType).toBe("payment_verified");
    expect(receipt.subjectType).toBe("order");
    expect(receipt.subjectId).toBe("101");
    expect(receipt.sourceType).toBe("stripe_payment_intent");
    expect(receipt.sourceRef).toBe("pi_real_123");
    expect(receipt.tenantId).toBe("tenant-a");

    // Payment write owns total, paid, paidAt, stripePaymentIntentId — NOT status
    expect(mockTx.set).toHaveBeenNthCalledWith(1, {
      total: "45.00",
      paid: true,
      paidAt,
      stripePaymentIntentId: "pi_real_123",
    });

    // Orders helper write owns status: "processing"
    expect(mockTx.set).toHaveBeenNthCalledWith(2, {
      status: "processing",
    });

    expect(receipt.statusDisposition).toEqual({
      previousStatus: "new",
      resultingStatus: "processing",
      transitioned: true,
      preservedExistingStatus: false,
      cancelled: false,
    });
  });

  it("rejects status in orderPatch at runtime before any database mutation", async () => {
    vi.mocked(getDb).mockResolvedValueOnce({} as any);
    await expect(
      admitNativeStripePayment({
        tenantId: "tenant-a",
        orderId: 101,
        paymentIntentId: "pi_123",
        paidAt: new Date(),
        orderPatch: { status: "processing" } as any,
      })
    ).rejects.toThrow(/Unauthorized field 'status'/);
  });

  it("rejects tenantId in orderPatch at runtime before any database mutation", async () => {
    vi.mocked(getDb).mockResolvedValueOnce({} as any);
    await expect(
      admitNativeStripePayment({
        tenantId: "tenant-a",
        orderId: 101,
        paymentIntentId: "pi_123",
        paidAt: new Date(),
        orderPatch: { tenantId: "tenant-b" } as any,
      })
    ).rejects.toThrow(/Unauthorized field 'tenantId'/);
  });

  it("preserves collected, processing, ready, delivered, and cancelled statuses without setting processing", async () => {
    const statuses = ["collected", "processing", "ready", "delivered", "cancelled"] as const;

    for (const preservedStatus of statuses) {
      const paidAt = new Date("2026-10-06T19:00:00.000Z");
      const mockTx = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        for: vi.fn().mockReturnThis(),
        limit: vi
          .fn()
          .mockResolvedValueOnce([{ id: 101, tenantId: "tenant-a", status: preservedStatus, paid: false, stripePaymentIntentId: null }])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              id: "auth-101",
              tenantId: "tenant-a",
              claimType: "payment_verified",
              subjectType: "order",
              subjectId: "101",
              sourceType: "stripe_payment_intent",
              sourceRef: `pi_${preservedStatus}`,
              actorType: "system",
              actorId: null,
              evidenceClass: "authoritative_external",
              verificationClass: "VERIFIED",
              admissionPolicy: "native_stripe_payment_v1",
              occurredAt: paidAt,
              admittedAt: paidAt,
              metadataJson: { orderId: 101 },
              idempotencyKey: `payment_verified:order:101:stripe_payment_intent:pi_${preservedStatus}`,
            },
          ]),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        onDuplicateKeyUpdate: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
      };
      vi.mocked(getDb).mockResolvedValueOnce({
        transaction: vi.fn((cb: any) => cb(mockTx)),
      } as any);

      const receipt = await admitNativeStripePayment({
        tenantId: "tenant-a",
        orderId: 101,
        paymentIntentId: `pi_${preservedStatus}`,
        paidAt,
        orderPatch: { total: "50.00" },
      });

      // Payment write occurs exactly once
      expect(mockTx.set).toHaveBeenCalledTimes(1);
      expect(mockTx.set).toHaveBeenCalledWith({
        total: "50.00",
        paid: true,
        paidAt,
        stripePaymentIntentId: `pi_${preservedStatus}`,
      });

      // Orders helper does NOT write status
      expect(receipt.statusDisposition).toEqual({
        previousStatus: preservedStatus,
        resultingStatus: preservedStatus,
        transitioned: false,
        preservedExistingStatus: true,
        cancelled: preservedStatus === "cancelled",
      });
    }
  });

  it("does not project paid state when authority receipt persistence fails", async () => {
    const mockTx = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      for: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValueOnce([{ id: 101, tenantId: "tenant-a", status: "new" }]).mockResolvedValue([]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      onDuplicateKeyUpdate: vi.fn(async () => {
        throw new Error("receipt persistence failed");
      }),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };
    vi.mocked(getDb).mockResolvedValueOnce({
      transaction: vi.fn((cb: any) => cb(mockTx)),
    } as any);

    await expect(
      admitNativeStripePayment({
        tenantId: "tenant-a",
        orderId: 101,
        paymentIntentId: "pi_provider_succeeded",
        paidAt: new Date("2026-10-07T02:40:00.000Z"),
        orderPatch: { total: "45.00" },
      })
    ).rejects.toThrow("receipt persistence failed");

    expect(mockTx.update).not.toHaveBeenCalled();
    expect(mockTx.set).not.toHaveBeenCalled();
  });

});
