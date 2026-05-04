import { createVendorProfile, updateVendorBranding } from "../../db";
import type { AgentTool } from "../toolRegistry";
import { getVendorCategoryPreset } from "../vendorCategoryPresets";
import { ensureVendor, inferCategoryKey, normalizeServiceModel, normalizeTrafficMode } from "./vendorToolUtils";

export const createVendorProfileTool: AgentTool<Record<string, any>> = {
  name: "createVendorProfileTool",
  description: "Create a tenant-scoped draft vendor profile with building-native scheduling defaults.",
  async execute(input, ctx) {
    const vendorId = await ensureVendor(input, ctx.tenantId);
    const preset = getVendorCategoryPreset(inferCategoryKey(input));
    const serviceModel = normalizeServiceModel(input.serviceModel);
    const profileId = await createVendorProfile({
      tenantId: ctx.tenantId,
      vendorId,
      businessName: String(input.businessName ?? input.name ?? "Draft Vendor"),
      vendorCategory: preset.internalCategoryKey,
      contactName: input.contactName ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      serviceModel,
      buildingNativeServiceAvailable: input.buildingNativeServiceAvailable ?? serviceModel !== "fixed_location",
      serviceAreaJson: input.serviceArea ?? input.serviceAreaJson ?? null,
      buildingsJson: input.buildings ?? input.buildingsJson ?? null,
      trafficProtectionMode: normalizeTrafficMode(input.trafficProtectionMode ?? preset.schedulingMode),
      resetTimeMinutes: Number(input.resetTimeMinutes ?? (preset.internalCategoryKey === "route_operator" ? 0 : 15)),
      geoClusteringEnabled: input.geoClusteringEnabled ?? preset.geoClusteringDefault,
      bookingLeadTimeHours: Number(input.bookingLeadTimeHours ?? 24),
      providerResponseTimeoutMinutes: Number(input.providerResponseTimeoutMinutes ?? preset.defaultProviderResponseTimeoutMinutes),
      calendarConnectionStatus: input.calendarConnectionStatus ?? "not_connected",
      payoutSetupStatus: input.payoutSetupStatus ?? "not_started",
      onboardingStatus: "collecting_details",
    });
    if (input.brandName || input.brandLogoUrl) {
      await updateVendorBranding(vendorId, { brandName: input.brandName ?? input.businessName, logoUrl: input.brandLogoUrl ?? null });
    }
    return {
      entityType: "vendor_profile",
      entityId: profileId,
      output: {
        vendorId,
        profileId,
        categoryPresetKey: preset.internalCategoryKey,
        buildingNativeServiceAvailable: input.buildingNativeServiceAvailable ?? serviceModel !== "fixed_location",
        providerResponseTimeoutMinutes: Number(input.providerResponseTimeoutMinutes ?? preset.defaultProviderResponseTimeoutMinutes),
        onboardingStatus: "collecting_details",
        activationRequiresApproval: true,
      },
    };
  },
};
