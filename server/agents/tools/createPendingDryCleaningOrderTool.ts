import { createOrder } from "../../db";
import type { AgentTool } from "../toolRegistry";

export const createPendingDryCleaningOrderTool: AgentTool<Record<string, any>, { orderId: number; status: "intake-pending" }> = {
  name: "createPendingDryCleaningOrderTool",
  description: "Create a dry-cleaning order that waits for garment intake and charge approval.",
  async execute(input, ctx) {
    const pickupDate = String(input.pickupDate);
    const pickupDateObj = new Date(`${pickupDate}T00:00:00`);
    pickupDateObj.setDate(pickupDateObj.getDate() + 1);
    const orderId = await createOrder({
      tenantId: ctx.tenantId,
      serviceType: "dry_cleaning",
      pickupDate,
      pickupTimeWindow: String(input.pickupTimeWindow ?? "TBD"),
      deliveryDate: input.deliveryDate ?? pickupDateObj.toISOString().split("T")[0],
      deliveryTimeWindow: input.deliveryTimeWindow ?? "TBD",
      address: String(input.address ?? input.buildingName ?? ""),
      unit: input.unit ?? null,
      specialInstructions: input.specialInstructions ?? "Dry cleaning intake pending.",
      firstName: String(input.firstName ?? "Unknown"),
      lastName: String(input.lastName ?? "Customer"),
      phone: String(input.phone ?? "unknown"),
      email: input.email ?? null,
      bldgUserId: input.bldgUserId ?? null,
      buildingSlug: input.buildingSlug ?? null,
      status: "intake-pending",
      paid: false,
    });
    return {
      entityType: "order",
      entityId: orderId,
      output: { orderId, status: "intake-pending" },
    };
  },
};
