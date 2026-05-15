import { getOrderById, updateOrderStatus } from "../../db";
import { isTrustedOrderStateActor } from "../permissions";
import type { AgentTool } from "../toolRegistry";

export const updateOrderStatusTool: AgentTool<Record<string, any>> = {
  name: "updateOrderStatusTool",
  description: "Update internal order state when triggered by trusted UI or driver flow.",
  async execute(input, ctx) {
    if (!isTrustedOrderStateActor(ctx)) {
      throw new Error("Order status updates require a trusted UI, human, or driver actor");
    }
    const orderId = Number(input.orderId);
    const order = await getOrderById(orderId);
    if (!order) throw new Error("Order not found");
    const status = input.status;
    if (!["new", "intake-pending", "collected", "processing", "ready", "delivered"].includes(status)) {
      throw new Error("Invalid order status");
    }
    await updateOrderStatus(orderId, status, {
      source: "driver_app_bldg",
      actorUserId: ctx.actorId ?? null,
      actorDisplayName: ctx.actorType,
    });
    return { entityType: "order", entityId: orderId, output: { orderId, status } };
  },
};
