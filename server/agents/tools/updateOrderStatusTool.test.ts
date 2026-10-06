import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getOrderById: vi.fn(),
  updateOrderStatus: vi.fn(),
}));

vi.mock("../../db", () => ({
  getOrderById: db.getOrderById,
  updateOrderStatus: db.updateOrderStatus,
}));

import { updateOrderStatusTool } from "./updateOrderStatusTool";

const driverCtx = {
  tenantId: "tenant-a",
  agentType: "driver_agent" as const,
  actorType: "driver" as const,
  actorId: "driver-1",
};

describe("updateOrderStatusTool tenant authority", () => {
  beforeEach(() => {
    db.getOrderById.mockReset();
    db.updateOrderStatus.mockReset();
    db.updateOrderStatus.mockResolvedValue(undefined);
  });

  it("updates only an order owned by the execution tenant", async () => {
    db.getOrderById.mockResolvedValue({
      id: 41,
      tenantId: "tenant-a",
      status: "new",
    });

    const result = await updateOrderStatusTool.execute(
      { orderId: 41, status: "collected" },
      driverCtx
    );

    expect(db.updateOrderStatus).toHaveBeenCalledWith(
      41,
      "collected",
      expect.objectContaining({
        actorUserId: "driver-1",
        actorDisplayName: "driver",
      })
    );
    expect(result.output).toEqual({ orderId: 41, status: "collected" });
  });

  it("fails closed for cross-tenant or missing tenant ownership", async () => {
    db.getOrderById.mockResolvedValue({
      id: 41,
      tenantId: "tenant-b",
      status: "new",
    });
    await expect(
      updateOrderStatusTool.execute(
        { orderId: 41, status: "collected" },
        driverCtx
      )
    ).rejects.toThrow("Order does not belong to tenant");

    db.getOrderById.mockResolvedValue({
      id: 42,
      tenantId: null,
      status: "new",
    });
    await expect(
      updateOrderStatusTool.execute(
        { orderId: 42, status: "collected" },
        driverCtx
      )
    ).rejects.toThrow("Order does not belong to tenant");

    expect(db.updateOrderStatus).not.toHaveBeenCalled();
  });
});
