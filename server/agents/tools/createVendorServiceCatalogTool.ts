import { createVendorServices } from "../../db";
import type { AgentTool } from "../toolRegistry";
import { getVendorCategoryPreset } from "../vendorCategoryPresets";
import { cents, inferCategoryKey } from "./vendorToolUtils";

export const createVendorServiceCatalogTool: AgentTool<Record<string, any>> = {
  name: "createVendorServiceCatalogTool",
  description: "Create a draft vendor service catalog from provided services or category templates.",
  async execute(input, ctx) {
    const vendorId = Number(input.vendorId);
    const preset = getVendorCategoryPreset(inferCategoryKey(input));
    const services = Array.isArray(input.services) && input.services.length > 0
      ? input.services
      : preset.serviceTemplates.map((template) => ({
          serviceName: template.name,
          durationMinutes: template.durationMinutes,
          basePriceCents: template.basePriceCents ?? 0,
        }));
    const ids = await createVendorServices(services.map((service: Record<string, any>) => ({
      tenantId: ctx.tenantId,
      vendorId,
      serviceName: String(service.serviceName ?? service.name),
      serviceCategory: service.serviceCategory ?? preset.internalCategoryKey,
      description: service.description ?? null,
      basePriceCents: cents(service.basePriceCents ?? service.price ?? service.basePrice),
      recommendedPriceCents: service.recommendedPriceCents != null ? cents(service.recommendedPriceCents) : null,
      durationMinutes: Number(service.durationMinutes ?? service.duration ?? 60),
      isMobile: service.isMobile ?? input.serviceModel !== "fixed_location",
      isBuildingNative: service.isBuildingNative ?? input.buildingNativeServiceAvailable ?? true,
      isActive: service.isActive ?? true,
    })));
    return { entityType: "vendor_service_catalog", entityId: vendorId, output: { vendorId, serviceIds: ids, servicesCreated: ids.length, draft: true } };
  },
};
