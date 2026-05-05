import { createVendorAdminConfig, updateVendorProfileByVendorId } from "../../db";
import type { AgentTool } from "../toolRegistry";
import { buildAdminConfig, generateUniqueVendorPublicBookingSlug } from "./vendorToolUtils";
import { buildDefaultTemplateContent, VENDOR_BOOKING_PUBLIC_BASE_URL, VENDOR_BOOKING_TEMPLATE_KEY } from "../../vendorBookingPublicApi";

export const configureVendorAdminTool: AgentTool<Record<string, any>> = {
  name: "configureVendorAdminTool",
  description: "Create config-driven vendor admin surfaces from an enable-list category preset.",
  async execute(input, ctx) {
    const vendorId = Number(input.vendorId);
    const publicBookingSlug = await generateUniqueVendorPublicBookingSlug(input, ctx.tenantId, vendorId);
    const config = buildAdminConfig({ ...input, publicBookingSlug });
    const templateContentJson = input.templateContentJson ?? buildDefaultTemplateContent({
      adminConfig: { ...config, vendorId, tenantId: ctx.tenantId } as any,
      profile: input.businessName ? {
        businessName: String(input.businessName),
        vendorCategory: config.categoryPresetKey,
      } as any : undefined,
    });
    const configId = await createVendorAdminConfig({
      tenantId: ctx.tenantId,
      vendorId,
      ...config,
      templateKey: input.templateKey ?? VENDOR_BOOKING_TEMPLATE_KEY,
      publicBookingStatus: "draft",
      templateContentJson,
      publishedAt: null,
      approvedByUserId: null,
    });
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
        templateKey: input.templateKey ?? VENDOR_BOOKING_TEMPLATE_KEY,
        publicBookingStatus: "draft",
        templateContent: templateContentJson,
        previewRoute: `/book/${config.publicBookingSlug}`,
        publicBookingUrl: `${VENDOR_BOOKING_PUBLIC_BASE_URL}/${config.publicBookingSlug}`,
        publicBookingPageLive: false,
        customDomainStatus: config.customDomainStatus,
      },
    };
  },
};
