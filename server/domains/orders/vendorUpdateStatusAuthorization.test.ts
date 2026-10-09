import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";

const mocks = vi.hoisted(() => ({
  getOrderById: vi.fn(),
  updateOrderStatus: vi.fn(),
  attemptOrderPickupCollection: vi.fn(),
  ensurePickupCompletedOperationsEventForOrder: vi.fn(),
  recordWarActionSafe: vi.fn(),
  notifyPickupEnRoute: vi.fn(),
  getDb: vi.fn(),
  readNativePaymentAuthorityReceipts: vi.fn(),
  hasNativePaymentAuthority: vi.fn(),
}));

vi.mock("../../db", async importOriginal => {
  const actual = await importOriginal<typeof import("../../db")>();
  return {
    ...actual,
    getOrderById: mocks.getOrderById,
    updateOrderStatus: mocks.updateOrderStatus,
    attemptOrderPickupCollection: mocks.attemptOrderPickupCollection,
    ensurePickupCompletedOperationsEventForOrder:
      mocks.ensurePickupCompletedOperationsEventForOrder,
    getDb: mocks.getDb,
  };
});

vi.mock("../payment/nativePaymentReadService", () => ({
  readNativePaymentAuthorityReceipts: mocks.readNativePaymentAuthorityReceipts,
  hasNativePaymentAuthority: mocks.hasNativePaymentAuthority,
}));

vi.mock("../../level4War", async importOriginal => {
  const actual = await importOriginal<typeof import("../../level4War")>();
  return {
    ...actual,
    recordWarActionSafe: mocks.recordWarActionSafe,
  };
});

vi.mock("../../_core/sms", async importOriginal => {
  const actual = await importOriginal<typeof import("../../_core/sms")>();
  return {
    ...actual,
    notifyPickupEnRoute: mocks.notifyPickupEnRoute,
  };
});

import { appRouter } from "../../routers";

function vendorCaller(vendorId = 77, tenantId = "default") {
  return appRouter.createCaller({
    req: {} as never,
    res: {} as never,
    user: null,
    vendorSession: { vendorId },
    tenantId,
  });
}

function adminCaller(tenantId = "default") {
  return appRouter.createCaller({
    req: {} as never,
    res: {} as never,
    user: {
      openId: "platform-admin-1",
      role: "admin",
      tenantId,
    } as never,
    vendorSession: null,
    tenantId,
  });
}

describe("tRPC admin.updateStatus vendor authorization and mutation-time guarantees", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateOrderStatus.mockResolvedValue(undefined);
    mocks.ensurePickupCompletedOperationsEventForOrder.mockResolvedValue(undefined);
    mocks.notifyPickupEnRoute.mockResolvedValue(undefined);
    mocks.readNativePaymentAuthorityReceipts.mockResolvedValue(new Map());
    mocks.hasNativePaymentAuthority.mockReturnValue(true);
  });

  it("denies vendor session call against unrelated unassigned SaaS order with UNAUTHORIZED", async () => {
    mocks.getOrderById.mockResolvedValue({
      id: 101,
      tenantId: "tenant-other",
      vendorId: null,
      status: "new",
      phone: "+13105550101",
    });

    const caller = vendorCaller(77, "default");
    await expect(
      caller.admin.updateStatus({ orderId: 101, status: "processing" })
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Order does not belong to tenant",
    });

    // Verification of downstream protection on DENY
    expect(mocks.updateOrderStatus).not.toHaveBeenCalled();
    expect(mocks.attemptOrderPickupCollection).not.toHaveBeenCalled();
    expect(mocks.recordWarActionSafe).not.toHaveBeenCalled();
    expect(mocks.ensurePickupCompletedOperationsEventForOrder).not.toHaveBeenCalled();
    expect(mocks.notifyPickupEnRoute).not.toHaveBeenCalled();
  });

  it("denies vendor session call against order assigned to another vendor with UNAUTHORIZED", async () => {
    mocks.getOrderById.mockResolvedValue({
      id: 102,
      tenantId: "tenant-other",
      vendorId: 88,
      status: "new",
      phone: "+13105550102",
    });

    const caller = vendorCaller(77, "default");
    await expect(
      caller.admin.updateStatus({ orderId: 102, status: "processing" })
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Order does not belong to tenant",
    });

    expect(mocks.updateOrderStatus).not.toHaveBeenCalled();
    expect(mocks.recordWarActionSafe).not.toHaveBeenCalled();
    expect(mocks.ensurePickupCompletedOperationsEventForOrder).not.toHaveBeenCalled();
  });

  it("allows vendor session call against unassigned order on the actual default host tenant", async () => {
    mocks.getOrderById
      .mockResolvedValueOnce({
        id: 103,
        tenantId: "default",
        vendorId: null,
        status: "new",
        phone: "+13105550103",
      })
      .mockResolvedValueOnce({
        id: 103,
        tenantId: "default",
        vendorId: null,
        status: "processing",
        phone: "+13105550103",
      });

    const caller = vendorCaller(77, "default");
    const result = await caller.admin.updateStatus({
      orderId: 103,
      status: "processing",
    });

    expect(result).toEqual({ success: true, alreadyCompleted: false });
    expect(mocks.updateOrderStatus).toHaveBeenCalledWith(
      103,
      "processing",
      expect.objectContaining({ source: "driver_app_bldg" }),
      expect.objectContaining({
        expectedTenantId: "default",
        requireUnassignedVendor: true,
      })
    );
    expect(mocks.recordWarActionSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "default",
        kind: "stage_advance",
        meta: { orderId: 103, status: "processing" },
      })
    );
  });

  it("allows vendor session call against cross-tenant order assigned to that vendor", async () => {
    mocks.getOrderById
      .mockResolvedValueOnce({
        id: 104,
        tenantId: "tenant-other",
        vendorId: 77,
        status: "new",
        phone: "+13105550104",
      })
      .mockResolvedValueOnce({
        id: 104,
        tenantId: "tenant-other",
        vendorId: 77,
        status: "processing",
        phone: "+13105550104",
      });

    const caller = vendorCaller(77, "default");
    const result = await caller.admin.updateStatus({
      orderId: 104,
      status: "processing",
    });

    expect(result).toEqual({ success: true, alreadyCompleted: false });
    expect(mocks.updateOrderStatus).toHaveBeenCalledWith(
      104,
      "processing",
      expect.objectContaining({ source: "driver_app_bldg" }),
      expect.objectContaining({
        expectedTenantId: "tenant-other",
        expectedVendorId: 77,
      })
    );
    expect(mocks.recordWarActionSafe).toHaveBeenCalled();
  });

  it("allows platform administrator explicit cross-tenant transition", async () => {
    mocks.getOrderById
      .mockResolvedValueOnce({
        id: 105,
        tenantId: "tenant-other",
        vendorId: null,
        status: "new",
        phone: "+13105550105",
      })
      .mockResolvedValueOnce({
        id: 105,
        tenantId: "tenant-other",
        vendorId: null,
        status: "processing",
        phone: "+13105550105",
      });

    const caller = adminCaller("default");
    const result = await caller.admin.updateStatus({
      orderId: 105,
      status: "processing",
    });

    expect(result).toEqual({ success: true, alreadyCompleted: false });
    expect(mocks.updateOrderStatus).toHaveBeenCalledWith(
      105,
      "processing",
      expect.objectContaining({ source: "driver_app_bldg" }),
      expect.objectContaining({
        expectedTenantId: "tenant-other",
      })
    );
  });

  it("denies pickup transition on unrelated unassigned order and suppresses all downstream events", async () => {
    mocks.getOrderById.mockResolvedValue({
      id: 106,
      tenantId: "tenant-other",
      vendorId: null,
      status: "new",
      phone: "+13105550106",
    });

    const caller = vendorCaller(77, "default");
    await expect(
      caller.admin.updateStatus({ orderId: 106, status: "collected" })
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Order does not belong to tenant",
    });

    expect(mocks.attemptOrderPickupCollection).not.toHaveBeenCalled();
    expect(mocks.ensurePickupCompletedOperationsEventForOrder).not.toHaveBeenCalled();
    expect(mocks.recordWarActionSafe).not.toHaveBeenCalled();
    expect(mocks.notifyPickupEnRoute).not.toHaveBeenCalled();
  });

  it("surfaces CONFLICT error on concurrent mutation failure and suppresses downstream events", async () => {
    mocks.getOrderById.mockResolvedValue({
      id: 107,
      tenantId: "tenant-other",
      vendorId: 77,
      status: "new",
      phone: "+13105550107",
    });
    mocks.updateOrderStatus.mockRejectedValueOnce(
      new Error("Order vendor assignment changed concurrently")
    );

    const caller = vendorCaller(77, "default");
    await expect(
      caller.admin.updateStatus({ orderId: 107, status: "processing" })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Order vendor assignment changed concurrently",
    });

    expect(mocks.recordWarActionSafe).not.toHaveBeenCalled();
  });

  it("allows default-host vendor 77 to deliver an assigned tenant-other order with admitted payment", async () => {
    const mockDb = {
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
        }),
      }),
    };
    mocks.getDb.mockResolvedValue(mockDb);
    mocks.getOrderById
      .mockResolvedValueOnce({
        id: 108,
        tenantId: "tenant-other",
        vendorId: 77,
        status: "ready",
        paid: true,
        stripePaymentIntentId: "pi_108",
        phone: "+13105550108",
      })
      .mockResolvedValueOnce({
        id: 108,
        tenantId: "tenant-other",
        vendorId: 77,
        status: "delivered",
        paid: true,
        stripePaymentIntentId: "pi_108",
        phone: "+13105550108",
      });

    const caller = vendorCaller(77, "default");
    const result = await caller.admin.updateStatus({
      orderId: 108,
      status: "delivered",
    });

    expect(result).toEqual({ success: true, alreadyCompleted: false });
  });

  it("denies vendor 88 from delivering a tenant-other order assigned to vendor 77", async () => {
    mocks.getOrderById.mockResolvedValue({
      id: 108,
      tenantId: "tenant-other",
      vendorId: 77,
      status: "ready",
      paid: true,
      stripePaymentIntentId: "pi_108",
      phone: "+13105550108",
    });

    const caller = vendorCaller(88, "default");
    await expect(
      caller.admin.updateStatus({ orderId: 108, status: "delivered" })
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("denies vendor 77 from delivering an unassigned tenant-other order", async () => {
    mocks.getOrderById.mockResolvedValue({
      id: 109,
      tenantId: "tenant-other",
      vendorId: null,
      status: "ready",
      paid: true,
      stripePaymentIntentId: "pi_109",
      phone: "+13105550109",
    });

    const caller = vendorCaller(77, "default");
    await expect(
      caller.admin.updateStatus({ orderId: 109, status: "delivered" })
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("denies delivery when order is unpaid or missing payment admission", async () => {
    // Unpaid
    mocks.getOrderById.mockResolvedValueOnce({
      id: 110,
      tenantId: "tenant-other",
      vendorId: 77,
      status: "ready",
      paid: false,
      phone: "+13105550110",
    });

    const caller = vendorCaller(77, "default");
    await expect(
      caller.admin.updateStatus({ orderId: 110, status: "delivered" })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Charge the order before marking it delivered.",
    });

    // Paid flag true without admission receipt
    mocks.getOrderById.mockResolvedValueOnce({
      id: 111,
      tenantId: "tenant-other",
      vendorId: 77,
      status: "ready",
      paid: true,
      stripePaymentIntentId: "pi_111",
      phone: "+13105550111",
    });
    mocks.hasNativePaymentAuthority.mockReturnValueOnce(false);

    await expect(
      caller.admin.updateStatus({ orderId: 111, status: "delivered" })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Matching Payment admission is required before delivery.",
    });
  });

  it("handles repeated delivery of the same order idempotently with no duplicate effects", async () => {
    mocks.getDb.mockResolvedValue({});
    mocks.getOrderById.mockResolvedValue({
      id: 112,
      tenantId: "tenant-other",
      vendorId: 77,
      status: "delivered",
      paid: true,
      stripePaymentIntentId: "pi_112",
      phone: "+13105550112",
    });

    const caller = vendorCaller(77, "default");
    const result = await caller.admin.updateStatus({
      orderId: 112,
      status: "delivered",
    });

    expect(result).toEqual({ success: true, alreadyCompleted: true });
  });
});
