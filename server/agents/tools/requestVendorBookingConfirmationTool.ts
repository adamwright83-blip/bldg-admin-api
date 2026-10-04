import type { AgentTool } from "../toolRegistry";

export const requestVendorBookingConfirmationTool: AgentTool<Record<string, any>> = {
  name: "requestVendorBookingConfirmationTool",
  description: "Prepare a provider booking-confirmation request. This tool does not send it.",
  requiresHumanApproval: true,
  async execute(input, ctx) {
    return {
      entityType: "vendor_booking_confirmation",
      entityId: input.requestId ?? input.bookingRequestId ?? null,
      output: {
        requestId: input.requestId ?? input.bookingRequestId ?? null,
        providerVendorId: input.providerVendorId ?? null,
        status: "prepared_awaiting_transport",
        messageSent: false,
        authorityReceiptId: null,
        customerCharged: false,
        operationalDetailsRevealed: input.operationalDetailsApproved === true,
        approvedByUserId: ctx.approvedByUserId,
      },
    };
  },
};
