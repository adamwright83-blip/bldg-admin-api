import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrderById: vi.fn(),
  updateOrderIntake: vi.fn(),
}));

vi.mock("../db", async importOriginal => ({
  ...(await importOriginal<any>()),
  getOrderById: mocks.getOrderById,
  updateOrderIntake: mocks.updateOrderIntake,
}));

import { appRouter } from "../routers";

function caller(input: {
  tenantId: string;
  openId: string;
  role: "admin" | "driver" | "user";
  vendorId?: number;
}) {
  return appRouter.createCaller({
    req: {} as never,
    res: {} as never,
    user: {
      id: 1,
      openId: input.openId,
      role: input.role,
      tenantId: input.tenantId,
    } as never,
    vendorSession:
      input.vendorId == null ? null : ({ vendorId: input.vendorId } as never),
    tenantId: input.tenantId,
  });
}

describe("admin native order ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hides another tenant's order from a tenant-local shared admin", async () => {
    mocks.getOrderById.mockResolvedValue({
      id: 20,
      tenantId: "tenant-b",
      vendorId: null,
    });
    await expect(
      caller({
        tenantId: "default",
        openId: "admin-owner",
        role: "admin",
      }).admin.getOrder({ id: 20 })
    ).resolves.toBeNull();
  });

  it("preserves explicit platform administrator cross-tenant order reads", async () => {
    const order = { id: 21, tenantId: "tenant-b", vendorId: null };
    mocks.getOrderById.mockResolvedValue(order);
    await expect(
      caller({
        tenantId: "default",
        openId: "oauth-platform-admin",
        role: "admin",
      }).admin.getOrder({ id: 21 })
    ).resolves.toEqual(order);
  });

  it("rejects tenant-local intake mutation against another tenant", async () => {
    mocks.getOrderById.mockResolvedValue({
      id: 22,
      tenantId: "tenant-b",
      vendorId: null,
    });
    await expect(
      caller({
        tenantId: "tenant-a",
        openId: "admin-owner",
        role: "admin",
      }).admin.saveIntake({
        orderId: 22,
        subtotal: "10.00",
        discountPercent: "0",
        total: "10.00",
      })
    ).rejects.toThrow("Order does not belong to tenant");
    expect(mocks.updateOrderIntake).not.toHaveBeenCalled();
  });

  it("preserves platform administrator cross-tenant intake", async () => {
    mocks.getOrderById.mockResolvedValue({
      id: 23,
      tenantId: "tenant-b",
      vendorId: null,
    });
    mocks.updateOrderIntake.mockResolvedValue(undefined);
    await expect(
      caller({
        tenantId: "default",
        openId: "oauth-platform-admin",
        role: "admin",
      }).admin.saveIntake({
        orderId: 23,
        subtotal: "10.00",
        discountPercent: "0",
        total: "10.00",
      })
    ).resolves.toEqual({ success: true });
  });

  it("preserves assigned-only vendor intake without imposing that rule on vendor status policy", async () => {
    mocks.getOrderById.mockResolvedValue({
      id: 24,
      tenantId: "tenant-b",
      vendorId: 8,
    });
    await expect(
      caller({
        tenantId: "default",
        openId: "vendor-host-user",
        role: "user",
        vendorId: 7,
      }).admin.saveIntake({
        orderId: 24,
        subtotal: "10.00",
        discountPercent: "0",
        total: "10.00",
      })
    ).rejects.toThrow("Order does not belong to vendor");
    expect(mocks.updateOrderIntake).not.toHaveBeenCalled();
  });
});
