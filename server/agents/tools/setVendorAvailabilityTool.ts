import { createVendorAvailabilityWindows, updateVendorProfileByVendorId } from "../../db";
import type { AgentTool } from "../toolRegistry";
import { normalizeTrafficMode } from "./vendorToolUtils";

export const setVendorAvailabilityTool: AgentTool<Record<string, any>> = {
  name: "setVendorAvailabilityTool",
  description: "Store vendor availability windows with traffic, reset time, and geo-clustering preferences.",
  async execute(input, ctx) {
    const vendorId = Number(input.vendorId);
    const windows = Array.isArray(input.windows) ? input.windows : [];
    const ids = await createVendorAvailabilityWindows(windows.map((window: Record<string, any>) => ({
      tenantId: ctx.tenantId,
      vendorId,
      dayOfWeek: Number(window.dayOfWeek),
      startTime: String(window.startTime),
      endTime: String(window.endTime),
      timezone: window.timezone ?? "America/Los_Angeles",
      buildingScopeJson: window.buildingScope ?? null,
      neighborhoodScopeJson: window.neighborhoodScope ?? null,
      isActive: window.isActive ?? true,
    })));
    await updateVendorProfileByVendorId(ctx.tenantId, vendorId, {
      trafficProtectionMode: normalizeTrafficMode(input.trafficProtectionMode),
      resetTimeMinutes: Number(input.resetTimeMinutes ?? 15),
      geoClusteringEnabled: input.geoClusteringEnabled ?? true,
      onboardingStatus: "availability_setup",
    });
    return {
      entityType: "vendor_availability",
      entityId: vendorId,
      output: {
        vendorId,
        availabilityWindowIds: ids,
        trafficProtectionMode: normalizeTrafficMode(input.trafficProtectionMode),
        resetTimeMinutes: Number(input.resetTimeMinutes ?? 15),
        geoClusteringEnabled: input.geoClusteringEnabled ?? true,
      },
    };
  },
};
