import { updateVendorProfileByVendorId } from "../../db";
import type { AgentTool } from "../toolRegistry";
import { manualApprovalWarningCopy } from "../vendorCategoryPresets";

export const configureVendorBookingRulesTool: AgentTool<Record<string, any>> = {
  name: "configureVendorBookingRulesTool",
  description: "Configure booking confirmation, lead time, cancellation, no-show, and time-protection rules.",
  async execute(input, ctx) {
    const vendorId = Number(input.vendorId);
    const bookingConfirmationMode = input.bookingConfirmationMode ?? "hybrid";
    await updateVendorProfileByVendorId(ctx.tenantId, vendorId, {
      bookingLeadTimeHours: Number(input.bookingLeadTimeHours ?? 24),
      providerResponseTimeoutMinutes: Number(input.providerResponseTimeoutMinutes ?? 120),
    });
    return {
      entityType: "vendor_booking_rules",
      entityId: vendorId,
      output: {
        vendorId,
        bookingConfirmationMode,
        bookingLeadTimeHours: Number(input.bookingLeadTimeHours ?? 24),
        providerResponseTimeoutMinutes: Number(input.providerResponseTimeoutMinutes ?? 120),
        timeProtectionRules: {
          cardOnFileRequired: input.cardOnFileRequired ?? true,
          depositPolicy: input.depositPolicy ?? null,
          cancellationFee: input.cancellationFee ?? null,
          noShowFee: input.noShowFee ?? null,
          minimumNoticeHours: input.minimumNoticeHours ?? null,
        },
        manualApprovalWarningCopy,
        chargesBeforeApproval: false,
      },
    };
  },
};
