import type { AgentTool } from "../toolRegistry";

export const requestVendorBookingConfirmationTool: AgentTool<Record<string, any>> = {
  name: "requestVendorBookingConfirmationTool",
  description: "Request provider confirmation before confirming or charging a vendor booking.",
  requiresHumanApproval: true,
  async execute(input, ctx) {
    return {
      entityType: "vendor_booking_confirmation",
      entityId: input.requestId ?? input.bookingRequestId ?? null,
      output: {
        requestId: input.requestId ?? input.bookingRequestId ?? null,
        providerVendorId: input.providerVendorId ?? null,
        status: "confirmation_requested",
        customerCharged: false,
        operationalDetailsRevealed: input.operationalDetailsApproved === true,
        approvedByUserId: ctx.approvedByUserId,
      },
    };
  },
};
