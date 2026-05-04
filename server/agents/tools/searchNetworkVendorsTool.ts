import { listVendorPeerServiceProviders } from "../../db";
import type { AgentTool } from "../toolRegistry";
import { detectVendorCategoryPreset } from "../vendorCategoryPresets";

export const searchNetworkVendorsTool: AgentTool<Record<string, any>> = {
  name: "searchNetworkVendorsTool",
  description: "Search safe network vendor matches without exposing cross-vendor private data.",
  async execute(input, ctx) {
    const serviceCategory = input.serviceCategory ?? detectVendorCategoryPreset(String(input.query ?? input.serviceRequested ?? ""));
    const providers = await listVendorPeerServiceProviders({
      tenantId: ctx.tenantId,
      serviceCategory,
      excludeVendorId: input.requestingVendorId != null ? Number(input.requestingVendorId) : null,
      limit: Number(input.limit ?? 3),
    });
    return {
      entityType: "network_vendor_search",
      entityId: serviceCategory,
      output: {
        serviceCategory,
        providers: providers.map((provider) => ({
          vendorId: provider.id,
          businessName: provider.name,
          category: provider.profile?.vendorCategory ?? serviceCategory,
          providerResponseTimeoutMinutes: provider.profile?.providerResponseTimeoutMinutes ?? 120,
          publicBookingSlug: provider.adminConfig?.publicBookingSlug ?? provider.slug ?? null,
        })),
        privateDataExcluded: ["customer lists", "revenue", "payment methods", "private bookings", "resident unit numbers"],
      },
    };
  },
};
