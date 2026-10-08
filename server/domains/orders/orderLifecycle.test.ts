import { beforeEach, describe, expect, it, vi } from "vitest";

const payment = vi.hoisted(() => ({ receipts: vi.fn(), authorized: vi.fn() }));
vi.mock("../payment/nativePaymentReadService", () => ({ readNativePaymentAuthorityReceipts: payment.receipts, hasNativePaymentAuthority: payment.authorized }));

const db = vi.hoisted(() => ({
  createOrder: vi.fn(),
  createOrReuseResidentLaundryOrder: vi.fn(),
  getOrderById: vi.fn(),
  updateOrderStatus: vi.fn(),
  attemptOrderPickupCollection: vi.fn(),
  getDb: vi.fn(),
  updateOrderIntake: vi.fn(),
}));

vi.mock("../../db", () => ({
  createOrder: db.createOrder,
  createOrReuseResidentLaundryOrder: db.createOrReuseResidentLaundryOrder,
  getOrderById: db.getOrderById,
  updateOrderStatus: db.updateOrderStatus,
  attemptOrderPickupCollection: db.attemptOrderPickupCollection,
  getDb: db.getDb,
  updateOrderIntake: db.updateOrderIntake,
}));

import {
  reviseNativeOrder,
  createNativeOrder,
  createOrReuseResidentOrder,
  transitionNativeOrderStatus,
  attemptOrderDeliveryTransition,
  OrderTransitionError,
} from "./orderLifecycleService";

describe("orderLifecycleService canonical authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    payment.receipts.mockResolvedValue(new Map());
    payment.authorized.mockReturnValue(true);
  });

  it("rejects paid-state or tenant changes in revisions before persistence", async () => {
    for (const patch of [
      { paid: true },
      { paid: false },
      { paidAt: new Date() },
      { tenantId: "other" },
      { platformFeeCents: 500 },
      { vendorPayoutCents: null },
      { stripeConnectedAccountIdSnapshot: "acct_other" },
    ]) {
      await expect(reviseNativeOrder(10, patch as never)).rejects.toThrow(
        /authority/
      );
    }
    expect(db.updateOrderIntake).not.toHaveBeenCalled();
  });

  it("does not claim a stale pickup completed when its CAS did not transition", async () => {
    db.getOrderById.mockResolvedValue({
      id: 10,
      tenantId: "tenant-a",
      status: "new",
    });
    db.attemptOrderPickupCollection.mockResolvedValue({
      transitioned: false,
      order: { id: 10, tenantId: "tenant-a", status: "cancelled" },
    });
    await expect(
      transitionNativeOrderStatus({
        orderId: 10,
        tenantId: "tenant-a",
        status: "collected",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  describe("createNativeOrder", () => {
    it("enforces tenant authority on native order creation", async () => {
      await expect(
        createNativeOrder({
          tenantId: "",
          serviceType: "wash_fold",
          pickupDate: "2026-10-10",
          pickupTimeWindow: "morning",
          deliveryDate: "2026-10-11",
          deliveryTimeWindow: "morning",
          address: "123 Main St",
          firstName: "John",
          lastName: "Doe",
          phone: "555-1234",
        } as any)
      ).rejects.toThrow("Order creation requires tenant authority");

      expect(db.createOrder).not.toHaveBeenCalled();
    });

    it("delegates to persistence when tenant authority is present", async () => {
      db.createOrder.mockResolvedValue(101);

      const id = await createNativeOrder({
        tenantId: "tenant-a",
        serviceType: "wash_fold",
        pickupDate: "2026-10-10",
        pickupTimeWindow: "morning",
        deliveryDate: "2026-10-11",
        deliveryTimeWindow: "morning",
        address: "123 Main St",
        firstName: "John",
        lastName: "Doe",
        phone: "555-1234",
      } as any);

      expect(id).toBe(101);
      expect(db.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "tenant-a" })
      );
    });
  });

  describe("createOrReuseResidentOrder", () => {
    it("preserves resident creation and idempotency delegation", async () => {
      db.createOrReuseResidentLaundryOrder.mockResolvedValue({
        orderId: 202,
        reused: true,
      });

      const result = await createOrReuseResidentOrder(
        { tenantId: "tenant-a" } as any,
        { clientRequestId: "req-1" }
      );

      expect(result).toEqual({ orderId: 202, reused: true });
      expect(db.createOrReuseResidentLaundryOrder).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "tenant-a" }),
        { clientRequestId: "req-1" }
      );
    });
  });

  describe("transitionNativeOrderStatus", () => {
    it("rejects non-existent order", async () => {
      db.getOrderById.mockResolvedValue(undefined);

      await expect(
        transitionNativeOrderStatus({
          orderId: 999,
          status: "processing",
        })
      ).rejects.toThrowError(OrderTransitionError);
    });

    it("rejects cross-tenant transition", async () => {
      db.getOrderById.mockResolvedValue({
        id: 10,
        tenantId: "tenant-other",
        status: "new",
      });

      await expect(
        transitionNativeOrderStatus({
          orderId: 10,
          status: "processing",
          tenantId: "tenant-mine",
        })
      ).rejects.toThrow("Order does not belong to tenant");
    });

    it("does not treat the default tenant as a wildcard", async () => {
      db.getOrderById.mockResolvedValue({
        id: 11,
        tenantId: "tenant-other",
        status: "new",
      });

      await expect(
        transitionNativeOrderStatus({
          orderId: 11,
          status: "processing",
          tenantId: "default",
        })
      ).rejects.toThrow("Order does not belong to tenant");
    });

    it("preserves explicit platform cross-tenant authority when supplied", async () => {
      db.getOrderById
        .mockResolvedValueOnce({
          id: 12,
          tenantId: "tenant-other",
          status: "new",
        })
        .mockResolvedValueOnce({
          id: 12,
          tenantId: "tenant-other",
          status: "processing",
        });

      await expect(
        transitionNativeOrderStatus({
          orderId: 12,
          status: "processing",
          tenantId: "default",
          allowCrossTenant: true,
        })
      ).resolves.toMatchObject({ success: true, alreadyCompleted: false });
    });

    it("preserves the existing vendor default-host unassigned transition behavior", async () => {
      db.getOrderById
        .mockResolvedValueOnce({
          id: 13,
          tenantId: "tenant-other",
          vendorId: null,
          status: "new",
        })
        .mockResolvedValueOnce({
          id: 13,
          tenantId: "tenant-other",
          vendorId: null,
          status: "processing",
        });

      await expect(
        transitionNativeOrderStatus({
          orderId: 13,
          status: "processing",
          tenantId: "default",
          vendorId: 77,
        })
      ).resolves.toMatchObject({ success: true, alreadyCompleted: false });
    });

    it("routes pickup through atomic attemptOrderPickupCollection", async () => {
      db.getOrderById.mockResolvedValue({
        id: 10,
        tenantId: "tenant-a",
        status: "new",
      });
      db.attemptOrderPickupCollection.mockResolvedValue({
        transitioned: true,
        order: { id: 10, tenantId: "tenant-a", status: "collected" },
      });

      const res = await transitionNativeOrderStatus({
        orderId: 10,
        status: "collected",
        tenantId: "tenant-a",
      });

      expect(res.success).toBe(true);
      expect(res.alreadyCompleted).toBe(false);
      expect(res.order.status).toBe("collected");
      expect(db.attemptOrderPickupCollection).toHaveBeenCalledWith(
        10,
        "tenant-a"
      );
    });

    it("handles idempotent replay of pickup", async () => {
      db.getOrderById.mockResolvedValue({
        id: 10,
        tenantId: "tenant-a",
        status: "collected",
      });
      db.attemptOrderPickupCollection.mockResolvedValue({
        transitioned: false,
        order: { id: 10, tenantId: "tenant-a", status: "collected" },
      });

      const res = await transitionNativeOrderStatus({
        orderId: 10,
        status: "collected",
        tenantId: "tenant-a",
      });

      expect(res.success).toBe(true);
      expect(res.alreadyCompleted).toBe(true);
      expect(res.order.status).toBe("collected");
    });

    it("rejects delivery when order is unpaid", async () => {
      db.getOrderById.mockResolvedValue({
        id: 10,
        tenantId: "tenant-a",
        status: "ready",
        paid: false,
      });
      db.getDb.mockResolvedValue({});

      await expect(
        transitionNativeOrderStatus({
          orderId: 10,
          status: "delivered",
          tenantId: "tenant-a",
        })
      ).rejects.toThrow("Charge the order before marking it delivered.");
    });

    it("allows delivery when order is paid", async () => {
      const mockTx = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
          }),
        }),
      };
      db.getDb.mockResolvedValue(mockTx);
      db.getOrderById
        .mockResolvedValueOnce({
          id: 10,
          tenantId: "tenant-a",
          status: "ready",
          paid: true,
        })
        .mockResolvedValueOnce({
          id: 10,
          tenantId: "tenant-a",
          status: "delivered",
          paid: true,
        });

      const res = await transitionNativeOrderStatus({
        orderId: 10,
        status: "delivered",
        tenantId: "tenant-a",
      });

      expect(res.success).toBe(true);
      expect(res.alreadyCompleted).toBe(false);
      expect(res.order.status).toBe("delivered");
    });

    it("handles delivery idempotent replay without updating database", async () => {
      db.getDb.mockResolvedValue({});
      db.getOrderById.mockResolvedValue({
        id: 10,
        tenantId: "tenant-a",
        status: "delivered",
        paid: true,
      });

      const res = await transitionNativeOrderStatus({
        orderId: 10,
        status: "delivered",
        tenantId: "tenant-a",
      });

      expect(res.success).toBe(true);
      expect(res.alreadyCompleted).toBe(true);
      expect(res.order.status).toBe("delivered");
    });

    it("executes standard transitions using updateOrderStatus", async () => {
      db.getOrderById
        .mockResolvedValueOnce({
          id: 10,
          tenantId: "tenant-a",
          status: "collected",
        })
        .mockResolvedValueOnce({
          id: 10,
          tenantId: "tenant-a",
          status: "processing",
        });

      const res = await transitionNativeOrderStatus({
        orderId: 10,
        status: "processing",
        tenantId: "tenant-a",
        actor: { source: "driver_app_bldg" },
      });

      expect(res.success).toBe(true);
      expect(res.alreadyCompleted).toBe(false);
      expect(db.updateOrderStatus).toHaveBeenCalledWith(
        10,
        "processing",
        expect.objectContaining({ source: "driver_app_bldg" })
      );
    });
  });
});


it("rejects a weak paid flag before issuing the delivery write", async () => {
  payment.receipts.mockResolvedValue(new Map());
  payment.authorized.mockReturnValue(false);
  db.getDb.mockResolvedValue({});
  db.getOrderById.mockResolvedValue({ id: 10, tenantId: "tenant-a", status: "ready", paid: true });
  await expect(attemptOrderDeliveryTransition(10)).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
});
