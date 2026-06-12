import { createOrReuseResidentLaundryOrder } from "../../db";
import type { AgentTool } from "../toolRegistry";

export const createLaundryOrderTool: AgentTool<Record<string, any>, { orderId: number; reused: boolean }> = {
  name: "createLaundryOrderTool",
  description: "Create a standard laundry order through the existing order creation helper.",
  async execute(input, ctx) {
    const pickupDate = String(input.pickupDate);
    // Route through the canonical idempotent helper (no direct createOrder).
    // The resident threads a clientRequestId per booking action; the helper
    // stamps it into the UNIQUE orders.residentClientRequestId column so
    // retries / double-submits / parallel paths resolve to the SAME order
    // (live duplicate orders #172/#173, 2026-06-12).
    const clientRequestId =
      typeof input.clientRequestId === "string" && input.clientRequestId.trim()
        ? input.clientRequestId.trim()
        : null;
    const { orderId, reused } = await createOrReuseResidentLaundryOrder(
      {
        tenantId: ctx.tenantId,
        serviceType: input.serviceType ?? "wash_fold",
        pickupDate,
        pickupTimeWindow: String(input.pickupTimeWindow),
        // Laundry Butler returns SAME DAY, 7–9 PM. The old defaults here
        // (pickup+1 day, pickup window reused as delivery window) are exactly
        // what live order #172 stored — wrong on both fields.
        deliveryDate: input.deliveryDate ?? pickupDate,
        deliveryTimeWindow: input.deliveryTimeWindow ?? "7–9 PM",
        address: String(input.address ?? ""),
        unit: input.unit ?? null,
        specialInstructions: input.specialInstructions ?? null,
        // Mirror the key for debugging; the physical column is authoritative.
        heldMetadataJson: clientRequestId ? { clientRequestId, source: "bldg-resident-s2s" } : null,
        heldSource: "bldg-resident",
        firstName: String(input.firstName),
        lastName: String(input.lastName),
        phone: String(input.phone),
        email: input.email ?? null,
        stripeCustomerId: input.stripeCustomerId ?? null,
        stripePaymentMethodId: input.stripePaymentMethodId ?? null,
        bldgUserId: input.bldgUserId ?? null,
        buildingSlug: input.buildingSlug ?? null,
        status: "new",
      },
      { clientRequestId }
    );
    if (reused) {
      console.log(`[createLaundryOrderTool] idempotent reuse — order #${orderId} (key=${clientRequestId ?? "none"})`);
    }
    return { entityType: "order", entityId: orderId, output: { orderId, reused } };
  },
};
