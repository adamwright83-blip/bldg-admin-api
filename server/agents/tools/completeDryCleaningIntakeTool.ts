import { getOrderById, updateOrderIntake } from "../../db";
import type { AgentTool } from "../toolRegistry";

export const completeDryCleaningIntakeTool: AgentTool<Record<string, any>> = {
  name: "completeDryCleaningIntakeTool",
  description: "Save corrected dry-cleaning garment intake and prepare a charge preview without charging.",
  async execute(input) {
    const orderId = Number(input.orderId);
    const order = await getOrderById(orderId);
    if (!order) throw new Error("Order not found");
    if (order.serviceType !== "dry_cleaning") throw new Error("Dry-cleaning intake requires a dry-cleaning order");
    if (order.paid) throw new Error("Order is already paid");

    const customerChargeCents = Number(input.customerChargeCents ?? 0);
    const partnerCostCents = Number(input.partnerCostCents ?? 0);
    if (!Number.isFinite(customerChargeCents) || customerChargeCents < 0) {
      throw new Error("Invalid customer charge amount");
    }

    const drycleanItemsJson = {
      lineItems: input.lineItems ?? [],
      partnerCostCents,
      customerChargeCents,
      manualCorrection: input.manualCorrection ?? null,
      intakeCompletedAt: new Date().toISOString(),
      chargeRequiresApproval: true,
    };
    await updateOrderIntake(orderId, {
      garmentCount: Array.isArray(input.lineItems) ? input.lineItems.length : null,
      drycleanItemsJson,
      subtotal: (customerChargeCents / 100).toFixed(2),
      total: (customerChargeCents / 100).toFixed(2),
      status: "collected",
      paid: false,
    });

    return {
      entityType: "order",
      entityId: orderId,
      output: {
        orderId,
        intakeComplete: true,
        chargePreview: { amountCents: customerChargeCents, requiresHumanApproval: true },
        charged: false,
      },
    };
  },
};
