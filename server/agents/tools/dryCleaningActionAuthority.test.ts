import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getOrderById: vi.fn(),
  updateOrderIntake: vi.fn(),
}));

vi.mock("../../db", () => ({
  getOrderById: db.getOrderById,
  updateOrderIntake: db.updateOrderIntake,
}));

import { attachReceiptToOrderTool } from "./attachReceiptToOrderTool";
import { completeDryCleaningIntakeTool } from "./completeDryCleaningIntakeTool";

const ctx = {
  tenantId: "tenant-a",
  agentType: "operator_voice_agent" as const,
  actorType: "human" as const,
  actorId: "operator-1",
};

describe("dry-cleaning action tenant authority", () => {
  beforeEach(() => {
    db.getOrderById.mockReset();
    db.updateOrderIntake.mockReset();
    db.updateOrderIntake.mockResolvedValue(undefined);
  });

  it("rejects receipt attachment for a different or unproven tenant", async () => {
    db.getOrderById.mockResolvedValue({
      id: 41,
      tenantId: "tenant-b",
      serviceType: "dry_cleaning",
      paid: false,
      status: "new",
      drycleanItemsJson: null,
    });
    await expect(
      attachReceiptToOrderTool.execute({ orderId: 41, receiptUrl: "https://x.test/r" }, ctx)
    ).rejects.toThrow("Order does not belong to tenant");

    db.getOrderById.mockResolvedValue({
      id: 42,
      tenantId: null,
      serviceType: "dry_cleaning",
      paid: false,
      status: "new",
      drycleanItemsJson: null,
    });
    await expect(
      attachReceiptToOrderTool.execute({ orderId: 42, receiptUrl: "https://x.test/r" }, ctx)
    ).rejects.toThrow("Order does not belong to tenant");

    expect(db.updateOrderIntake).not.toHaveBeenCalled();
  });

  it("rejects intake completion for a different tenant before mutation", async () => {
    db.getOrderById.mockResolvedValue({
      id: 43,
      tenantId: "tenant-b",
      serviceType: "dry_cleaning",
      paid: false,
      status: "intake-pending",
    });

    await expect(
      completeDryCleaningIntakeTool.execute(
        {
          orderId: 43,
          customerChargeCents: 2000,
          partnerCostCents: 1000,
          lineItems: [],
        },
        ctx
      )
    ).rejects.toThrow("Order does not belong to tenant");

    expect(db.updateOrderIntake).not.toHaveBeenCalled();
  });
});
