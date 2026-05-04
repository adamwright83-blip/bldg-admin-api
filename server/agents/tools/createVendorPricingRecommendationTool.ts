import { createVendorPricingRecommendation } from "../../db";
import type { AgentTool } from "../toolRegistry";
import { cents } from "./vendorToolUtils";

export const createVendorPricingRecommendationTool: AgentTool<Record<string, any>> = {
  name: "createVendorPricingRecommendationTool",
  description: "Create draft pricing recommendations with an audit trail; never auto-applies pricing.",
  async execute(input, ctx) {
    const basePriceCents = cents(input.basePriceCents ?? input.basePrice);
    const conveniencePremiumPercent = Number(input.conveniencePremiumPercent ?? 10);
    const recommendedPriceCents = input.recommendedPriceCents != null
      ? cents(input.recommendedPriceCents)
      : Math.round(basePriceCents * (1 + conveniencePremiumPercent / 100));
    const travelTimeMinutesAssumed = Number(input.travelTimeMinutesAssumed ?? 20);
    const estimatedBookingsPerDay = Number(input.estimatedBookingsPerDay ?? 4);
    const reasoning = input.reasoning ?? [
      `Base price ${basePriceCents} cents.`,
      `Assumed ${travelTimeMinutesAssumed} minutes of travel burden.`,
      `Estimated ${estimatedBookingsPerDay} building-native bookings per day.`,
      `Applied ${conveniencePremiumPercent}% convenience premium for mobile appointment density and margin protection.`,
      `Geo-clustering enabled: ${input.geoClusteringEnabled ?? true}.`,
      "Recommendation remains draft until approved.",
    ].join(" ");
    const id = await createVendorPricingRecommendation({
      tenantId: ctx.tenantId,
      vendorId: Number(input.vendorId),
      serviceId: input.serviceId != null ? Number(input.serviceId) : null,
      basePriceCents,
      recommendedPriceCents,
      conveniencePremiumPercent,
      travelTimeMinutesAssumed,
      estimatedBookingsPerDay,
      comparablePricingJson: input.comparablePricing ?? null,
      reasoning,
      status: "draft",
    });
    return { entityType: "vendor_pricing_recommendation", entityId: id, output: { recommendationId: id, recommendedPriceCents, status: "draft", autoApplied: false, reasoning } };
  },
};
