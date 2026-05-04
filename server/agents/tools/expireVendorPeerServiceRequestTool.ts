import { updateVendorPeerServiceRequest } from "../../db";
import type { AgentTool } from "../toolRegistry";

export const expireVendorPeerServiceRequestTool: AgentTool<Record<string, any>> = {
  name: "expireVendorPeerServiceRequestTool",
  description: "Expire a peer-service request after provider response timeout and attach safe alternatives.",
  async execute(input, ctx) {
    const requestId = Number(input.requestId);
    await updateVendorPeerServiceRequest(ctx.tenantId, requestId, {
      status: "expired",
      expiredAt: new Date(),
      timeoutReason: input.timeoutReason ?? "provider_response_timeout",
      replacementOptionsJson: input.replacementOptions ?? [],
    });
    return {
      entityType: "vendor_peer_service_request",
      entityId: requestId,
      output: {
        requestId,
        status: "expired",
        timeoutReason: input.timeoutReason ?? "provider_response_timeout",
        alternatives: input.replacementOptions ?? [],
      },
    };
  },
};
