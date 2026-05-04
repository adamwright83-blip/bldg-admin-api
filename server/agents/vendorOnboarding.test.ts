import { describe, expect, it } from "vitest";
import { listAgentTools } from "./toolRegistry";
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
