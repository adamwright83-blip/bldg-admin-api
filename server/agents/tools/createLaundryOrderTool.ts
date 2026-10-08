import { createOrReuseResidentOrder } from "../../domains/orders/orderLifecycleService";
import {
  assertResidentIdentityOrLineage,
  resolveResidentActionId,
} from "../residentActionAuthority";
import type { AgentTool } from "../toolRegistry";

export const createLaundryOrderTool: AgentTool<Record<string, any>, { orderId: number; reused: boolean }> = {
  name: "createLaundryOrderTool",
  description: "Create a standard laundry order through the existing order creation helper.",
  async execute(input, ctx) {
    const residentId = resolveResidentActionId(ctx, input.bldgUserId);
    assertResidentIdentityOrLineage({
      residentId,
      conversationId: ctx.conversationId,
      sessionId: ctx.sessionId,
    });

    const pickupDate = String(input.pickupDate);
    const clientRequestId =
      typeof input.clientRequestId === "string" && input.clientRequestId.trim()
        ? input.clientRequestId.trim()
        : null;
    const { orderId, reused } = await createOrReuseResidentOrder(
      {
        tenantId: ctx.tenantId,
        serviceType: input.serviceType ?? "wash_fold",
        pickupDate,
        pickupTimeWindow: String(input.pickupTimeWindow),
        deliveryDate: input.deliveryDate ?? pickupDate,
        deliveryTimeWindow: input.deliveryTimeWindow ?? "7–9 PM",
        address: String(input.address ?? ""),
        unit: input.unit ?? null,
        specialInstructions: input.specialInstructions ?? null,
        heldMetadataJson: clientRequestId
          ? { clientRequestId, source: "bldg-resident-s2s" }
          : null,
        heldSource: "bldg-resident",
        firstName: String(input.firstName),
        lastName: String(input.lastName),
        phone: String(input.phone),
        email: input.email ?? null,
        stripeCustomerId: input.stripeCustomerId ?? null,
        stripePaymentMethodId: input.stripePaymentMethodId ?? null,
        bldgUserId: residentId,
        buildingSlug: input.buildingSlug ?? null,
        status: "new",
      },
      { clientRequestId }
    );
    if (reused) {
      console.log(
        `[createLaundryOrderTool] idempotent reuse — order #${orderId} (key=${clientRequestId ?? "none"})`
      );
    }
    return {
      entityType: "order",
      entityId: orderId,
      output: { orderId, reused },
    };
  },
};
