import { createOrReuseResidentLaundryOrder } from "../../db";
import type { AgentTool } from "../toolRegistry";

export const createLaundryOrderTool: AgentTool<Record<string, any>, { orderId: number }> = {
  name: "createLaundryOrderTool",
  description: "Create a standard laundry order through the existing order creation helper.",
  async execute(input, ctx) {
    const pickupDate = String(input.pickupDate);
    const pickupDateObj = new Date(`${pickupDate}T00:00:00`);
    pickupDateObj.setDate(pickupDateObj.getDate() + 1);
    // Route through the canonical idempotent helper (no direct createOrder) so
    // this server-to-server tool can no longer create duplicate resident orders.
    // No clientRequestId here, so it relies on the composite open-order guard.
    const { orderId } = await createOrReuseResidentLaundryOrder({
      tenantId: ctx.tenantId,
      serviceType: input.serviceType ?? "wash_fold",
      pickupDate,
      pickupTimeWindow: String(input.pickupTimeWindow),
      deliveryDate: input.deliveryDate ?? pickupDateObj.toISOString().split("T")[0],
      deliveryTimeWindow: input.deliveryTimeWindow ?? input.pickupTimeWindow,
      address: String(input.address ?? ""),
      unit: input.unit ?? null,
      specialInstructions: input.specialInstructions ?? null,
      firstName: String(input.firstName),
      lastName: String(input.lastName),
      phone: String(input.phone),
      email: input.email ?? null,
      stripeCustomerId: input.stripeCustomerId ?? null,
      stripePaymentMethodId: input.stripePaymentMethodId ?? null,
      bldgUserId: input.bldgUserId ?? null,
      buildingSlug: input.buildingSlug ?? null,
      status: "new",
    });
    return { entityType: "order", entityId: orderId, output: { orderId } };
  },
};
