import { getOrderById, updateOrderStatus } from "../../db";
import type { AgentTool } from "../toolRegistry";

type CancelResidentOrderInput = {
  orderId?: number | string | null;
  bldgUserId?: number | null;
  reason?: string | null;
};

export const cancelResidentOrderTool: AgentTool<CancelResidentOrderInput> = {
  name: "cancelResidentOrderTool",
  description: "Cancel a resident-owned order directly without asking the vendor for permission.",
  async execute(input, ctx) {
    const orderId = Number(input.orderId);
    if (!Number.isFinite(orderId) || orderId <= 0) throw new Error("orderId is required");

    const order = await getOrderById(orderId);
    if (!order) throw new Error("Order not found");
    if (!order.tenantId || order.tenantId !== ctx.tenantId) {
      throw new Error("Order does not belong to tenant");
    }

    const rawActorId = ctx.actorId?.trim() ?? "";
    const actorMatch = rawActorId.match(/^(?:bldg_user:|resident:)?(\d+)$/i);
    const actorResidentId = actorMatch ? Number(actorMatch[1]) : null;
    const inputResidentId = Number(input.bldgUserId);
    const requestedResidentId =
      Number.isInteger(inputResidentId) && inputResidentId > 0
        ? inputResidentId
        : actorResidentId;
    if (requestedResidentId == null) {
      throw new Error("Resident cancellation requires resident identity authority");
    }
    if (actorResidentId != null && actorResidentId !== requestedResidentId) {
      throw new Error("Resident actor identity does not match cancellation authority");
    }
    if (order.bldgUserId == null || Number(order.bldgUserId) !== requestedResidentId) {
      throw new Error("Order does not belong to resident");
    }

    if (order.status !== "cancelled") {
      await updateOrderStatus(orderId, "cancelled", {
        source: "driver_app_bldg",
        actorDisplayName: "resident_chat",
      });
    }

    return {
      entityType: "order",
      entityId: orderId,
      output: {
        orderId,
        orderCancelled: true,
        previousStatus: order.status,
        status: "cancelled",
        notifyText: `Resident cancelled order #${orderId}.`,
      },
    };
  },
};
