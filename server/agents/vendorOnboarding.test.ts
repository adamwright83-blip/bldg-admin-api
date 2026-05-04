import { describe, expect, it } from "vitest";
import { listAgentTools } from "./toolRegistry";
import {
  generateUniqueVendorPublicBookingSlug,
  generateVendorPublicBookingSlug,
  inferCategoryKey,
} from "./tools/vendorToolUtils";
import {
  detectVendorCategoryPreset,
  detectVendorOnboardingIntent,
  getVendorCategoryPreset,
  manualApprovalWarningCopy,
  vendorCategoryPresets,
  vendorOnboardingFirstQuestion,
} from "./vendorCategoryPresets";

describe("universal vendor onboarding presets", () => {
  it("detects vendor onboarding intent and starts from website/Instagram/booking link copy", () => {
    expect(detectVendorOnboardingIntent("I run a hair salon and want to join BLDG.chat")).toBe(true);
    expect(vendorOnboardingFirstQuestion).toContain("website, Instagram, or current booking page");
  });

  it("maps visible vendor categories to reusable presets instead of hair-stylist-specific code", () => {
    expect(detectVendorCategoryPreset("I offer mobile haircuts at Century Park East")).toBe("beauty_mobile");
    expect(detectVendorCategoryPreset("I run an auto detailing business")).toBe("auto_detail");
    expect(detectVendorCategoryPreset("I offer pet grooming")).toBe("pet_care");
    expect(detectVendorCategoryPreset("Laundry and dry cleaning pickup route")).toBe("route_operator");
    expect(inferCategoryKey({ vendorCategory: "hair stylist" })).toBe("beauty_mobile");
  });

  it("generates correct enabled surfaces from preset enable-lists", () => {
    expect(getVendorCategoryPreset("beauty_mobile").enabledAdminSurfaces).toEqual([
      "today",
      "bookings",
      "availability",
      "services",
      "clients",
      "payments",
      "request_service",
      "messages",
      "settings",
    ]);
    expect(getVendorCategoryPreset("route_operator").enabledAdminSurfaces).toContain("driver_missions");
    expect(getVendorCategoryPreset("pet_care").enabledAdminSurfaces).toContain("pet_profiles");
  });

  it("sets scheduling, geo-clustering, response timeout, and theme defaults by category", () => {
    expect(getVendorCategoryPreset("beauty_mobile")).toMatchObject({
      defaultAdminTheme: "clinical_minimalist",
      geoClusteringDefault: true,
      defaultProviderResponseTimeoutMinutes: 120,
      bookingConfirmationMode: "hybrid",
      schedulingMode: "geo_clustered",
    });
    expect(getVendorCategoryPreset("auto_detail").defaultProviderResponseTimeoutMinutes).toBeGreaterThanOrEqual(30);
    expect(getVendorCategoryPreset("auto_detail").defaultProviderResponseTimeoutMinutes).toBeLessThanOrEqual(60);
    expect(getVendorCategoryPreset("route_operator")).toMatchObject({
      defaultAdminTheme: "pixel_operations",
      defaultProviderResponseTimeoutMinutes: 30,
      driverAppNeeded: true,
    });
  });

  it("keeps manual approval warning copy available for booking confirmation flows", () => {
    expect(manualApprovalWarningCopy).toContain("Manual approval gives you more control");
    expect(manualApprovalWarningCopy).toContain("expect fast confirmation");
  });

  it("keeps launch examples elevated while preserving internal operational categories", () => {
    const visibleExamples = Object.values(vendorCategoryPresets).flatMap((preset) => preset.examples);
    expect(visibleExamples).toContain("Hair Stylist");
    expect(visibleExamples).toContain("Private Trainer");
    expect(visibleExamples).toContain("Garment Care");
    expect(visibleExamples).not.toContain("cleaner");
    expect(vendorCategoryPresets.residence_care.examples).toContain("Private Space Care");
  });
});

describe("vendor agent tool registration", () => {
  it("registers all vendor onboarding tools so runtime calls write agent_events", () => {
    const names = listAgentTools().map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([
      "prefillVendorFromWebTool",
      "collectVendorDetailsTool",
      "createVendorProfileTool",
      "createVendorServiceCatalogTool",
      "setVendorAvailabilityTool",
      "configureVendorGeoClusteringTool",
      "configureVendorBookingRulesTool",
      "configureVendorAdminTool",
      "setVendorAdminThemeTool",
      "createVendorPricingRecommendationTool",
      "createVendorDirectBookingSessionTool",
      "createVendorGuestBookingSessionTool",
      "createVendorPeerServiceRequestTool",
      "searchNetworkVendorsTool",
      "requestVendorBookingConfirmationTool",
      "expireVendorPeerServiceRequestTool",
      "exportVendorDataTool",
      "createVendorAdminCommandTool",
      "logVendorOnboardingAbandonmentTool",
      "scanAbandonedVendorOnboardingSessionsTool",
    ]));
  });

  it("marks provider booking confirmation as approval-gated", () => {
    expect(listAgentTools().find((tool) => tool.name === "requestVendorBookingConfirmationTool")).toMatchObject({
      requiresHumanApproval: true,
    });
  });
});

describe("vendor public booking slug generation", () => {
  it("uses businessName first and removes accents", () => {
    expect(generateVendorPublicBookingSlug({ businessName: "Lumière Hair Studio" })).toBe("lumiere-hair-studio");
    expect(generateVendorPublicBookingSlug({ businessName: "J.R. Luxury Detail" })).toBe("jr-luxury-detail");
    expect(generateVendorPublicBookingSlug({ businessName: "  Luxe___Hair!!! " })).toBe("luxe-hair");
  });

  it("derives from normal domains when businessName is missing", () => {
    expect(generateVendorPublicBookingSlug({ websiteOrInstagram: "https://www.luxehair.studio" })).toBe("luxehair");
    expect(generateVendorPublicBookingSlug({ sourceUrl: "https://www.lumierehair.com" })).toBe("lumierehair");
  });

  it("derives from Instagram URLs and handles", () => {
    expect(generateVendorPublicBookingSlug({ websiteOrInstagram: "https://instagram.com/lumierehairstudio" })).toBe("lumierehairstudio");
    expect(generateVendorPublicBookingSlug({ websiteOrInstagram: "@lumierehairstudio" })).toBe("lumierehairstudio");
  });

  it("extracts path handles from generic booking platforms instead of platform hosts", () => {
    expect(generateVendorPublicBookingSlug({ websiteOrInstagram: "https://www.vagaro.com/luxehairla" })).toBe("luxehairla");
    expect(generateVendorPublicBookingSlug({ websiteOrInstagram: "https://www.styleseat.com/m/lumierehairstudio" })).toBe("lumierehairstudio");
    expect(generateVendorPublicBookingSlug({ websiteOrInstagram: "https://glossgenius.com/lumierehair" })).toBe("lumierehair");
  });

  it("falls back to category plus suffix for unusable inputs and never returns plain vendor", () => {
    expect(generateVendorPublicBookingSlug({ websiteOrInstagram: "https://www.vagaro.com", vendorCategory: "hair stylist" })).toMatch(/^hair-stylist-[a-f0-9]{4}$/);
    expect(generateVendorPublicBookingSlug({ vendorCategory: "hair stylist" })).toMatch(/^hair-stylist-[a-f0-9]{4}$/);
    expect(generateVendorPublicBookingSlug({ websiteOrInstagram: "https://www.vagaro.com" })).not.toBe("vendor");
  });

  it("uses email local part only as a last brand-like fallback", () => {
    expect(generateVendorPublicBookingSlug({ email: "hello@lumierehair.com", vendorCategory: "hair stylist" })).toMatch(/^hair-stylist-[a-f0-9]{4}$/);
    expect(generateVendorPublicBookingSlug({ email: "lumierehair@gmail.com" })).toBe("lumierehair");
  });

  it("appends a numeric suffix when a slug is taken", async () => {
    const slug = await generateUniqueVendorPublicBookingSlug(
      {
        businessName: "Lumière Hair Studio",
        isSlugTaken: (candidate: string) => candidate === "lumiere-hair-studio",
      },
      "default"
    );
    expect(slug).toBe("lumiere-hair-studio-2");
  });
});
