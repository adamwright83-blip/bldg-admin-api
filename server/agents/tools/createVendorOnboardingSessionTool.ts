import { createVendorOnboardingSession, updateVendorProfileByVendorId } from "../../db";
import type { AgentTool } from "../toolRegistry";
import { detectVendorCategoryPreset, detectVendorOnboardingIntent, noPublicSourceFallback, vendorOnboardingFirstQuestion } from "../vendorCategoryPresets";
import { ensureVendor, inferCategoryKey, slugify } from "./vendorToolUtils";

export const createVendorOnboardingSessionTool: AgentTool<Record<string, any>> = {
  name: "createVendorOnboardingSessionTool",
  description: "Start a universal vendor onboarding session and ask for website/Instagram/booking page first.",
  async execute(input, ctx) {
    const shouldCreateVendor = Boolean(input.businessName ?? input.name ?? input.email);
    const vendorId = shouldCreateVendor ? await ensureVendor(input, ctx.tenantId) : input.vendorId != null ? Number(input.vendorId) : null;
    const categoryPresetKey = input.vendorCategory || input.categoryPresetKey
      ? inferCategoryKey(input)
      : detectVendorCategoryPreset(String(input.intent ?? input.message ?? ""));
    const sessionId = String(input.sessionId ?? ctx.sessionId ?? `vendor_${Date.now()}`);
    const conversationId = input.conversationId ?? ctx.conversationId ?? null;
    const onboardingSessionId = await createVendorOnboardingSession({
      tenantId: ctx.tenantId,
      vendorId,
      sessionId,
      conversationId,
      vendorCategory: categoryPresetKey,
      status: "started",
      lastCompletedStep: "intent_detected",
      missingFieldsJson: input.missingFields ?? null,
    });
    if (vendorId != null) {
      await updateVendorProfileByVendorId(ctx.tenantId, vendorId, { onboardingStatus: "started" }).catch(() => undefined);
    }
    return {
      entityType: "vendor_onboarding_session",
      entityId: onboardingSessionId,
      output: {
        onboardingSessionId,
        vendorId,
        sessionId,
        conversationId,
        intentDetected: detectVendorOnboardingIntent(String(input.intent ?? input.message ?? "")),
        categoryPresetKey,
        firstQuestion: input.hasNoPublicSource ? noPublicSourceFallback : vendorOnboardingFirstQuestion,
        publicBookingSlug: slugify(String(input.publicBookingSlug ?? input.brandName ?? input.businessName ?? input.name ?? "vendor")),
        onboardingStatus: "started",
      },
    };
  },
};
