import { updateVendorOnboardingSession } from "../../db";
import type { AgentTool } from "../toolRegistry";

export const logVendorOnboardingAbandonmentTool: AgentTool<Record<string, any>> = {
  name: "logVendorOnboardingAbandonmentTool",
  description: "Log onboarding abandonment telemetry at 2h, 24h, or 7d using valid agent_events status values.",
  async execute(input, ctx) {
    const interval = input.abandonmentInterval ?? "2h";
    const sessionRowId = input.onboardingSessionId != null ? Number(input.onboardingSessionId) : null;
    if (sessionRowId != null) {
      await updateVendorOnboardingSession(ctx.tenantId, sessionRowId, {
        ...(interval === "2h" ? { abandoned2hLoggedAt: new Date() } : {}),
        ...(interval === "24h" ? { abandoned24hLoggedAt: new Date() } : {}),
        ...(interval === "7d" ? { abandoned7dLoggedAt: new Date(), abandonedAt: new Date(), status: "abandoned" } : {}),
      });
    }
    return {
      entityType: "vendor_onboarding_session",
      entityId: sessionRowId ?? input.sessionId ?? null,
      output: {
        eventKind: "onboarding_abandonment",
        abandonmentInterval: interval,
        lastCompletedOnboardingStep: input.lastCompletedStep ?? null,
        vendorCategory: input.vendorCategory ?? null,
        missingRequiredFields: input.missingRequiredFields ?? input.missingFields ?? [],
        sessionId: input.sessionId ?? ctx.sessionId ?? null,
        conversationId: input.conversationId ?? ctx.conversationId ?? null,
        timestamp: new Date().toISOString(),
      },
    };
  },
};
