import type { AgentTool } from "../toolRegistry";

export const requestVendorConfirmationTool: AgentTool<Record<string, any>> = {
  name: "requestVendorConfirmationTool",
  description: "Ask a vendor to confirm a marketplace booking before any customer charge.",
  requiresHumanApproval: true,
  async execute(input, ctx) {
    return {
      entityType: "vendor_booking_confirmation",
      entityId: input.bookingRequestId ?? null,
      output: {
        bookingRequestId: input.bookingRequestId ?? null,
        vendorId: input.vendorId ?? null,
        residentId: input.residentId ?? null,
        requestedWindow: input.requestedWindow ?? null,
        status: "confirmation_requested",
        customerCharged: false,
        marketplaceRule: "charge_after_vendor_confirms",
        approvedByUserId: ctx.approvedByUserId,
      },
    };
  },
};
