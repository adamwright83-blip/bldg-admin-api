import type { AgentTool } from "../toolRegistry";

export const requestVendorConfirmationTool: AgentTool<Record<string, any>> = {
  name: "requestVendorConfirmationTool",
  description: "Prepare a vendor-confirmation request. This tool does not send it.",
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
        status: "prepared_awaiting_transport",
        messageSent: false,
        authorityReceiptId: null,
        customerCharged: false,
        marketplaceRule: "charge_after_vendor_confirms",
        approvedByUserId: ctx.approvedByUserId,
      },
    };
  },
};
