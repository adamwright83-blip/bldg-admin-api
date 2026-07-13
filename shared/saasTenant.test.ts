import { describe, expect, it } from "vitest";
import {
  normalizeSaasEmail,
  normalizeSaasTenantSlug,
  onboardingConfigurationIsOperational,
  subscriptionAllowsDayforgeAccess,
  type SaasTenantOnboardingConfiguration,
} from "./saasTenant";

const configuration: SaasTenantOnboardingConfiguration = {
  businessName: "Westside Laundry",
  slug: "westside-laundry",
  contactName: "Owner",
  contactEmail: "owner@example.com",
  contactPhone: null,
  website: "https://example.com",
  timeZone: "America/Los_Angeles",
  brandName: "Westside Laundry",
  logoUrl: null,
  primaryColor: "#f26922",
  proposalTemplateKey: null,
  locations: [
    {
      label: "Main store",
      address: "100 Main St, Los Angeles, CA",
      serviceRadiusMiles: 4,
      maxPoundsPerDay: 600,
      maxPoundsByWeekday: { monday: 600 },
      openCapacityPoundsPerWeek: 1200,
      pickupDays: ["monday", "thursday"],
      routeWindows: ["9am-1pm"],
      turnaroundHours: 24,
      deliveryEnabled: true,
    },
  ],
  services: [
    {
      locationKey: null,
      serviceKey: "commercial-wash-fold",
      name: "Commercial wash and fold",
      enabled: true,
      commercialEnabled: true,
      pricePerPoundCents: 225,
      minimumOrderCents: 5000,
      terms: null,
    },
  ],
  importProviderKey: "cleancloud_csv",
};

describe("SaaS tenant contract", () => {
  it("normalizes tenant and login identity deterministically", () => {
    expect(normalizeSaasTenantSlug("  Westside Laundry #2 ")).toBe(
      "westside-laundry-2"
    );
    expect(normalizeSaasEmail(" Owner@Example.COM ")).toBe("owner@example.com");
  });

  it("allows an explicitly bounded past-due grace period", () => {
    expect(
      subscriptionAllowsDayforgeAccess({
        status: "past_due",
        now: new Date("2026-01-01T00:00:00.000Z"),
        graceEndsAt: new Date("2026-01-02T00:00:00.000Z"),
      })
    ).toBe(true);
    expect(
      subscriptionAllowsDayforgeAccess({
        status: "past_due",
        now: new Date("2026-01-03T00:00:00.000Z"),
        graceEndsAt: new Date("2026-01-02T00:00:00.000Z"),
      })
    ).toBe(false);
  });

  it("allows product access only for paid or trialing truth", () => {
    expect(subscriptionAllowsDayforgeAccess("active")).toBe(true);
    expect(subscriptionAllowsDayforgeAccess("trialing")).toBe(true);
    expect(subscriptionAllowsDayforgeAccess("past_due")).toBe(false);
    expect(subscriptionAllowsDayforgeAccess("canceled")).toBe(false);
  });

  it("requires real capacity, radius, turnaround, store, and service data", () => {
    expect(onboardingConfigurationIsOperational(configuration)).toBe(true);
    expect(
      onboardingConfigurationIsOperational({
        ...configuration,
        locations: [{ ...configuration.locations[0]!, maxPoundsPerDay: 0 }],
      })
    ).toBe(false);
    expect(
      onboardingConfigurationIsOperational({
        ...configuration,
        services: [
          { ...configuration.services[0]!, locationKey: "Missing store" },
        ],
      })
    ).toBe(false);
  });
});
