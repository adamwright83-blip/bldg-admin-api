import { getOrderById, updateOrderIntake } from "../../db";
import type { AgentTool } from "../toolRegistry";

export const attachReceiptToOrderTool: AgentTool<Record<string, any>> = {
  name: "attachReceiptToOrderTool",
  description: "Attach a dry-cleaner receipt reference to an intake-pending dry-cleaning order.",
  async execute(input) {
    const orderId = Number(input.orderId);
    const order = await getOrderById(orderId);
    if (!order) throw new Error("Order not found");
    if (order.serviceType !== "dry_cleaning") throw new Error("Receipt attachment requires a dry-cleaning order");
    if (order.paid) throw new Error("Cannot attach intake receipt to an already paid order");

    const existing = (order.drycleanItemsJson && typeof order.drycleanItemsJson === "object")
      ? order.drycleanItemsJson as Record<string, unknown>
      : {};
    const receipt = {
      receiptUrl: input.receiptUrl ?? null,
      receiptImageKey: input.receiptImageKey ?? null,
      uploadedAt: new Date().toISOString(),
      parsedLineItems: input.parsedLineItems ?? null,
    };
    await updateOrderIntake(orderId, {
      drycleanItemsJson: { ...existing, receipt },
      status: order.status === "new" ? "intake-pending" : order.status,
    });
    return { entityType: "order", entityId: orderId, output: { orderId, receiptAttached: true, receipt } };
  },
};
