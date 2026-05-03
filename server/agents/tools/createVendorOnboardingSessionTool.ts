import { createVendor, updateVendorBranding, updateVendorSlug } from "../../db";
import type { AgentTool } from "../toolRegistry";

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "vendor";
}

export const createVendorOnboardingSessionTool: AgentTool<Record<string, any>> = {
  name: "createVendorOnboardingSessionTool",
  description: "Create a vendor onboarding session for solo contractors, defaulting to confirmation-required when calendar access is unavailable.",
  async execute(input) {
    const vendorId = await createVendor({
      name: String(input.name),
      email: input.email ?? null,
      country: input.country ?? "US",
      platformFeePercent: input.platformFeePercent ?? null,
    });
    const slug = input.slug ? slugify(String(input.slug)) : slugify(String(input.name));
    await updateVendorSlug(vendorId, slug);
    if (input.brandName || input.logoUrl) {
      await updateVendorBranding(vendorId, {
        brandName: input.brandName ?? input.name,
        logoUrl: input.logoUrl ?? null,
      });
    }

    const calendarProvider = input.calendarProvider ?? null;
    const calendarAccessible = input.calendarAccessible === true;
    const bookingMode = calendarAccessible ? "calendar_backed" : "confirmation_required";
    return {
      entityType: "vendor",
      entityId: vendorId,
      output: {
        vendorId,
        slug,
        servicesOffered: input.servicesOffered ?? [],
        pricing: input.pricing ?? [],
        serviceArea: input.serviceArea ?? null,
        travelBufferMinutes: input.travelBufferMinutes ?? null,
        preferredLeadTimeMinutes: input.preferredLeadTimeMinutes ?? null,
        calendarProvider,
        calendarAccessible,
        bookingMode,
        stripeConnectSetupStatus: input.stripeConnectSetupStatus ?? "not_started",
        eligibleBuildings: input.eligibleBuildings ?? [],
      },
    };
  },
};
