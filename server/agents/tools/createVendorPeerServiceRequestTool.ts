import { createVendorPeerServiceRequest } from "../../db";
import type { AgentTool } from "../toolRegistry";
import { cents } from "./vendorToolUtils";

export const createVendorPeerServiceRequestTool: AgentTool<Record<string, any>> = {
  name: "createVendorPeerServiceRequestTool",
  description: "Create a vendor-to-vendor service request pending provider confirmation; does not charge.",
  async execute(input, ctx) {
    const responseTimeoutMinutes = Number(input.responseTimeoutMinutes ?? input.providerResponseTimeoutMinutes ?? 120);
    const expiresAt = new Date(Date.now() + responseTimeoutMinutes * 60 * 1000);
    const id = await createVendorPeerServiceRequest({
      tenantId: ctx.tenantId,
      requestingVendorId: Number(input.requestingVendorId),
      providerVendorId: input.providerVendorId != null ? Number(input.providerVendorId) : null,
      serviceCategory: String(input.serviceCategory),
      serviceRequested: String(input.serviceRequested),
      buildingName: input.buildingName ?? null,
      locationDetailsJson: input.locationDetails ?? null,
      preferredWindowStart: input.preferredWindowStart ? new Date(input.preferredWindowStart) : null,
      preferredWindowEnd: input.preferredWindowEnd ? new Date(input.preferredWindowEnd) : null,
      recommendedPriceCents: input.recommendedPriceCents != null ? cents(input.recommendedPriceCents) : null,
      status: "request_pending_provider_confirmation",
      responseTimeoutMinutes,
      expiresAt,
      replacementOptionsJson: null,
    });
    return {
      entityType: "vendor_peer_service_request",
      entityId: id,
      output: {
        requestId: id,
        status: "request_pending_provider_confirmation",
        customerCharged: false,
        providerVisibleFields: ["requesting vendor business name", "service requested", "building name", "preferred time window", "recommended price or range", "general notes"],
        hiddenUntilConfirmation: ["customer list", "revenue", "payment methods", "private bookings", "resident unit number"],
        expiresAt: expiresAt.toISOString(),
      },
    };
  },
};
