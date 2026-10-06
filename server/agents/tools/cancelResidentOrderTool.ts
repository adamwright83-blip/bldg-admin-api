import { getOrderById, updateOrderStatus } from "../../db";
import type { AgentTool } from "../toolRegistry";

type CancelResidentOrderInput = {
  orderId?: number | string | null;
  bldgUserId?: number | null;
  reason?: string | null;
};

const LEGACY_SINGLE_TENANT_ID = "default";

function requiredResidentUserId(value: number | null | undefined): number {
  const residentUserId = Number(value);
  if (!Number.isSafeInteger(residentUserId) || residentUserId <= 0) {
    throw new Error("Resident cancellation requires the resident owner id");
  }
  return residentUserId;
}

function effectiveOrderTenantId(value: string | null | undefined): string {
  return value?.trim() || LEGACY_SINGLE_TENANT_ID;
}

export const cancelResidentOrderTool: AgentTool<CancelResidentOrderInput> = {
  name: "cancelResidentOrderTool",
  description: "Cancel a resident-owned order directly without asking the vendor for permission.",
  async execute(input, ctx) {
    if (ctx.agentType !== "resident_agent" || ctx.actorType !== "resident_chat") {
      throw new Error("Resident cancellation requires the resident action authority");
    }

    const tenantId = ctx.tenantId.trim();
    if (!tenantId) throw new Error("Resident cancellation requires tenant authority");

    const residentUserId = requiredResidentUserId(input.bldgUserId);
    const orderId = Number(input.orderId);
    if (!Number.isSafeInteger(orderId) || orderId <= 0) {
      throw new Error("orderId is required");
    }

    const order = await getOrderById(orderId);
    if (!order) throw new Error("Order not found");

    if (effectiveOrderTenantId(order.tenantId) !== tenantId) {
      throw new Error("Order does not belong to tenant");
    }

    const orderResidentUserId = Number(order.bldgUserId);
    if (
      !Number.isSafeInteger(orderResidentUserId) ||
      orderResidentUserId <= 0 ||
      orderResidentUserId !== residentUserId
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
