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
    if (ctx.agentType !== "resident_agent" || ctx.actorType !== "resident_chat") {
      throw new Error("Resident cancellation requires the resident action authority");
    }

    const tenantId = ctx.tenantId.trim();
    if (!tenantId) {
      throw new Error("Resident cancellation requires tenant authority");
    }

    const residentUserId = Number(input.bldgUserId);
    if (!Number.isSafeInteger(residentUserId) || residentUserId <= 0) {
      throw new Error("Resident cancellation requires the resident owner id");
    }

    const orderId = Number(input.orderId);
    if (!Number.isSafeInteger(orderId) || orderId <= 0) {
      throw new Error("orderId is required");
    }

    const rawActorId = ctx.actorId?.trim() ?? "";
    const actorMatch = rawActorId.match(/^(?:bldg_user:|resident:)?(\d+)$/i);
    const actorResidentId = actorMatch ? Number(actorMatch[1]) : null;
    if (actorResidentId != null && actorResidentId !== residentUserId) {
      throw new Error("Resident actor identity does not match cancellation authority");
    }

    const order = await getOrderById(orderId);
    if (!order) throw new Error("Order not found");
    if (!order.tenantId || order.tenantId !== tenantId) {
      throw new Error("Order does not belong to tenant");
    }
    if (
      order.bldgUserId == null ||
      Number(order.bldgUserId) !== residentUserId
    ) {
      throw new Error("Order does not belong to resident");
    }

    if (order.status !== "cancelled") {
      await updateOrderStatus(orderId, "cancelled", {
        source: "driver_app_bldg",
        actorUserId: ctx.actorId ?? String(residentUserId),
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
