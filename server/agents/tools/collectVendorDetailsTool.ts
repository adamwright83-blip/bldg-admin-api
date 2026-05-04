import type { AgentTool } from "../toolRegistry";
import { getVendorCategoryPreset, manualApprovalWarningCopy, noPublicSourceFallback, vendorOnboardingFirstQuestion } from "../vendorCategoryPresets";
import { inferCategoryKey, missingVendorFields } from "./vendorToolUtils";

export const collectVendorDetailsTool: AgentTool<Record<string, any>> = {
  name: "collectVendorDetailsTool",
  description: "Identify missing vendor onboarding fields and return focused follow-up questions.",
  async execute(input) {
    const missingFields = missingVendorFields(input);
    const preset = getVendorCategoryPreset(inferCategoryKey(input));
    const questions: string[] = [];
    if (!input.sourceUrl && !input.hasNoPublicSource) questions.push(vendorOnboardingFirstQuestion);
    if (input.hasNoPublicSource) questions.push(noPublicSourceFallback);
    if (missingFields.includes("serviceModel")) {
      questions.push("How do you serve clients? A. I come to the resident/building. B. Clients come to me. C. Both. For the BLDG.chat resident network, we recommend offering at least one building-native service.");
    }
    if (missingFields.includes("availability")) {
      questions.push("When you have appointments in different buildings, how do you want your day scheduled? A. Back-to-back. B. Breathing room. C. Geo-clustered. How much reset time do you want after travel: none, 15 minutes, 30 minutes, or custom?");
    }
    if (missingFields.includes("bookingConfirmationMode")) {
      questions.push(`How should bookings confirm? A. Instant-confirm inside my approved rules. B. Ask me first. C. Hybrid. ${manualApprovalWarningCopy}`);
    }
    if (!input.timeProtectionRules) {
      questions.push("Do you want to protect your time with card on file, deposit, cancellation fee, no-show fee, or a minimum notice window?");
    }
    for (const field of missingFields.filter((field) => !["serviceModel", "availability", "bookingConfirmationMode"].includes(field))) {
      questions.push(`Please confirm ${field}.`);
    }
    return {
      entityType: "vendor_onboarding_details",
      entityId: input.vendorId ?? input.sessionId ?? null,
      output: {
        categoryPresetKey: preset.internalCategoryKey,
        visibleCategoryLabel: preset.visibleLabel,
        missingFields,
        specialRequiredFields: preset.specialRequiredFields,
        questions,
        reassurance: "Your client list is yours. You can export your clients, bookings, and services at any time.",
      },
    };
  },
};
