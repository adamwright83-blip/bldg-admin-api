import { updateVendorProfileByVendorId } from "../../db";
import type { AgentTool } from "../toolRegistry";

export const configureVendorGeoClusteringTool: AgentTool<Record<string, any>> = {
  name: "configureVendorGeoClusteringTool",
  description: "Configure mobile vendor geo-clustering to prevent impossible cross-LA scheduling.",
  async execute(input, ctx) {
    const vendorId = Number(input.vendorId);
    const rules = {
      sameBuilding: true,
      adjacentBuildings: true,
      sameNeighborhood: true,
      nearbyZipCodes: input.nearbyZipCodes ?? [],
      maxTravelMinutes: Number(input.maxTravelMinutes ?? 25),
    };
    await updateVendorProfileByVendorId(ctx.tenantId, vendorId, {
      geoClusteringEnabled: input.geoClusteringEnabled ?? true,
      serviceAreaJson: { ...(input.serviceArea ?? {}), geoClusteringRules: rules },
    });
    return { entityType: "vendor_geo_clustering", entityId: vendorId, output: { vendorId, geoClusteringEnabled: input.geoClusteringEnabled ?? true, rules } };
  },
};
