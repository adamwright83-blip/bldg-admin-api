import type { AgentTool } from "../toolRegistry";
import { slugify } from "./vendorToolUtils";
import { VENDOR_BOOKING_PUBLIC_BASE_URL } from "../../vendorBookingPublicApi";

export const createVendorDirectBookingSessionTool: AgentTool<Record<string, any>> = {
  name: "createVendorDirectBookingSessionTool",
  description: "Create a vendor direct booking session/link where vendor brand is primary and BLDG.chat is infrastructure.",
  async execute(input) {
    const slug = slugify(String(input.publicBookingSlug ?? input.brandName ?? input.vendorId));
    return {
      entityType: "vendor_direct_booking_session",
      entityId: input.vendorId ?? slug,
      output: {
        vendorId: input.vendorId ?? null,
        publicBookingSlug: slug,
        bookingUrl: `${VENDOR_BOOKING_PUBLIC_BASE_URL}/${slug}`,
        publicBookingPageLive: false,
        requiresPublish: true,
        customDomain: input.customDomain ?? null,
        customDomainStatus: input.customDomain ? "pending_dns" : "not_configured",
        brandMode: input.externalBookingBrandMode ?? "vendor_primary",
        guestFirst: true,
        accountRequiredBeforeBooking: false,
      },
    };
  },
};
