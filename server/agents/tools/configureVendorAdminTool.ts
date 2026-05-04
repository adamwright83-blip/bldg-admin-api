import { createVendorAdminConfig, updateVendorProfileByVendorId } from "../../db";
import type { AgentTool } from "../toolRegistry";
import { buildAdminConfig } from "./vendorToolUtils";

export const configureVendorAdminTool: AgentTool<Record<string, any>> = {
  name: "configureVendorAdminTool",
  description: "Create config-driven vendor admin surfaces from an enable-list category preset.",
  async execute(input, ctx) {
    const vendorId = Number(input.vendorId);
    const config = buildAdminConfig(input);
    const configId = await createVendorAdminConfig({ tenantId: ctx.tenantId, vendorId, ...config });
    await updateVendorProfileByVendorId(ctx.tenantId, vendorId, { onboardingStatus: "admin_configured" });
    return {
      entityType: "vendor_admin_config",
      entityId: configId,
      output: {
        vendorId,
        configId,
        categoryPresetKey: config.categoryPresetKey,
        themeKey: config.themeKey,
        enabledSurfaces: config.enabledSurfacesJson,
        defaultHiddenSurfaces: true,
        publicBookingUrl: `${config.publicBookingSlug}.bldg.chat`,
        customDomainStatus: config.customDomainStatus,
      },
    };
  },
};
