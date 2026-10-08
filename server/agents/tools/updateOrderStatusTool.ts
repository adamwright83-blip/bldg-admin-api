import { getOrderById } from "../../db";
import { transitionNativeOrderStatus } from "../../domains/orders/orderLifecycleService";
import { isTrustedOrderStateActor } from "../permissions";
import type { AgentTool } from "../toolRegistry";
import { assertOrderTenantAuthority } from "../../domains/orders/orderOwnership";

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
    const tenantId = assertOrderTenantAuthority({
      order,
      tenantId: ctx.tenantId,
    });
    const status = input.status;
    if (!["new", "intake-pending", "collected", "processing", "ready", "delivered"].includes(status)) {
      throw new Error("Invalid order status");
    }
    await transitionNativeOrderStatus({
      orderId,
      status,
      tenantId,
      actor: {
        source: "driver_app_bldg",
        actorUserId: ctx.actorId ?? null,
        actorDisplayName: ctx.actorType,
      },
    });
    return { entityType: "order", entityId: orderId, output: { orderId, status } };
  },
};
