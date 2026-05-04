import { createVendorGuestBookingSession } from "../../db";
import type { AgentTool } from "../toolRegistry";

export const createVendorGuestBookingSessionTool: AgentTool<Record<string, any>> = {
  name: "createVendorGuestBookingSessionTool",
  description: "Create a guest-first booking session with SMS/OTP and optional trusted-device friction reduction.",
  async execute(input, ctx) {
    const sessionId = await createVendorGuestBookingSession({
      tenantId: ctx.tenantId,
      vendorId: Number(input.vendorId),
      phone: input.phone ?? null,
      otpVerified: input.otpVerified ?? false,
      trustedDeviceHash: input.trustedDeviceHash ?? input.deviceTokenHash ?? null,
      serviceId: input.serviceId != null ? Number(input.serviceId) : null,
      requestedWindowJson: input.requestedWindow ?? null,
      status: input.status ?? "started",
    });
    return {
      entityType: "vendor_guest_booking_session",
      entityId: sessionId,
      output: {
        sessionId,
        vendorId: Number(input.vendorId),
        otpVerified: input.otpVerified ?? false,
        accountRequiredBeforeBooking: false,
        optionalAccountCreationAfterBooking: true,
        trustedDeviceHashPresent: Boolean(input.trustedDeviceHash ?? input.deviceTokenHash),
        repeatBookingFrictionReduced: Boolean(input.trustedDeviceHash ?? input.deviceTokenHash),
        cardRequiredForProtectedBookings: true,
      },
    };
  },
};
