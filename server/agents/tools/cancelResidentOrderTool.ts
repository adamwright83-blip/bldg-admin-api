import { getOrderById } from "../../db";
import { transitionNativeOrderStatus } from "../../domains/orders/orderLifecycleService";
import {
  positiveIntegerOrNull,
  resolveResidentActionId,
} from "../residentActionAuthority";
import type { AgentTool } from "../toolRegistry";
import {
  assertOrderResidentAuthority,
  assertOrderTenantAuthority,
} from "../../domains/orders/orderOwnership";

type CancelResidentOrderInput = {
  orderId?: number | string | null;
  bldgUserId?: number | null;
  reason?: string | null;
};

export const cancelResidentOrderTool: AgentTool<CancelResidentOrderInput> = {
  name: "cancelResidentOrderTool",
  description: "Cancel a resident-owned order directly without asking the vendor for permission.",
  async execute(input, ctx) {
    if (positiveIntegerOrNull(input.bldgUserId) == null) {
      throw new Error("Resident cancellation requires the resident owner id");
    }

    const residentUserId = resolveResidentActionId(ctx, input.bldgUserId, {
      required: true,
      principalError: "Resident cancellation requires the resident action authority",
      tenantError: "Resident cancellation requires tenant authority",
      requiredError: "Resident cancellation requires the resident owner id",
      mismatchError:
        "Resident actor identity does not match cancellation authority",
    })!;

    const orderId = Number(input.orderId);
    if (!Number.isSafeInteger(orderId) || orderId <= 0) {
      throw new Error("orderId is required");
    }

    const order = await getOrderById(orderId);
    if (!order) throw new Error("Order not found");
    assertOrderTenantAuthority({
      order,
      tenantId: ctx.tenantId,
    });
    assertOrderResidentAuthority({
      order,
      residentId: residentUserId,
    });

    if (order.status !== "cancelled") {
      await transitionNativeOrderStatus({
        orderId,
        status: "cancelled",
        tenantId: ctx.tenantId,
        actor: {
          source: "driver_app_bldg",
          actorUserId: ctx.actorId ?? String(residentUserId),
          actorDisplayName: "resident_chat",
        },
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
