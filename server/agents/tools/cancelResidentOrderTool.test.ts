import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getOrderById: vi.fn(),
  updateOrderStatus: vi.fn(),
}));

vi.mock("../../db", () => ({
  getOrderById: db.getOrderById,
  updateOrderStatus: db.updateOrderStatus,
}));

import { cancelResidentOrderTool } from "./cancelResidentOrderTool";

const ctx = {
  tenantId: "tenant-a",
  agentType: "resident_agent" as const,
  actorType: "resident_chat" as const,
  actorId: "resident-session-user",
};

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 44,
    tenantId: "tenant-a",
    bldgUserId: 7001,
    status: "new",
    ...overrides,
  };
}

describe("cancelResidentOrderTool authority boundary", () => {
  beforeEach(() => {
    db.getOrderById.mockReset();
    db.updateOrderStatus.mockReset();
    db.updateOrderStatus.mockResolvedValue(undefined);
  });

  it("fails closed when resident ownership evidence is missing", async () => {
    await expect(
      cancelResidentOrderTool.execute({ orderId: 44 }, ctx)
    ).rejects.toThrow("resident owner id");

    expect(db.getOrderById).not.toHaveBeenCalled();
    expect(db.updateOrderStatus).not.toHaveBeenCalled();
  });

  it("rejects an order from another tenant before mutation", async () => {
    db.getOrderById.mockResolvedValue(order({ tenantId: "tenant-b" }));

    await expect(
      cancelResidentOrderTool.execute(
        { orderId: 44, bldgUserId: 7001 },
        ctx
      )
    ).rejects.toThrow("Order does not belong to tenant");

    expect(db.updateOrderStatus).not.toHaveBeenCalled();
  });

  it("rejects an order with no resident owner instead of treating missing ownership as permission", async () => {
    db.getOrderById.mockResolvedValue(order({ bldgUserId: null }));

    await expect(
      cancelResidentOrderTool.execute(
        { orderId: 44, bldgUserId: 7001 },
        ctx
      )
    ).rejects.toThrow("Order does not belong to resident");

    expect(db.updateOrderStatus).not.toHaveBeenCalled();
  });

  it("rejects a different resident owner", async () => {
    db.getOrderById.mockResolvedValue(order({ bldgUserId: 8002 }));

    await expect(
      cancelResidentOrderTool.execute(
        { orderId: 44, bldgUserId: 7001 },
        ctx
      )
    ).rejects.toThrow("Order does not belong to resident");

    expect(db.updateOrderStatus).not.toHaveBeenCalled();
  });

  it("requires the resident action principal", async () => {
    await expect(
      cancelResidentOrderTool.execute(
        { orderId: 44, bldgUserId: 7001 },
        { ...ctx, actorType: "human" as const }
      )
    ).rejects.toThrow("resident action authority");

    expect(db.getOrderById).not.toHaveBeenCalled();
  });

  it("cancels only a same-tenant order owned by the exact resident", async () => {
    db.getOrderById.mockResolvedValue(order());

    const result = await cancelResidentOrderTool.execute(
      { orderId: 44, bldgUserId: 7001 },
      ctx
    );

    expect(db.updateOrderStatus).toHaveBeenCalledWith(44, "cancelled", {
      source: "driver_app_bldg",
      actorUserId: "resident-session-user",
      actorDisplayName: "resident_chat",
    });
    expect(result.output).toMatchObject({
      orderId: 44,
      orderCancelled: true,
      previousStatus: "new",
      status: "cancelled",
    });
  });

  it("keeps an already-cancelled owned order idempotent", async () => {
    db.getOrderById.mockResolvedValue(order({ status: "cancelled" }));

    const result = await cancelResidentOrderTool.execute(
      { orderId: 44, bldgUserId: 7001 },
      ctx
    );

    expect(db.updateOrderStatus).not.toHaveBeenCalled();
    expect(result.output).toMatchObject({
      orderCancelled: true,
      previousStatus: "cancelled",
      status: "cancelled",
    });
  });

  it("preserves the existing legacy default-tenant seam while still requiring resident ownership", async () => {
    db.getOrderById.mockResolvedValue(order({ tenantId: null }));

    await cancelResidentOrderTool.execute(
      { orderId: 44, bldgUserId: 7001 },
      { ...ctx, tenantId: "default" }
    );

    expect(db.updateOrderStatus).toHaveBeenCalledTimes(1);
  });
});
