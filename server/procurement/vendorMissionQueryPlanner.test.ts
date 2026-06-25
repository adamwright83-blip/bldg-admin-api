import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_QUERY_VARIANTS, planMissionQuery } from "./vendorMissionQueryPlanner";

describe("planMissionQuery -- mobile/building-service intent", () => {
  it("detects mobile_required from explicit mobile mission text", () => {
    const plan = planMissionQuery({
      missionText: "Find me 10 mobile dog groomers near 90027 with 4.7+ ratings who can service luxury high-rise residents at their buildings.",
      category: "dog_grooming", geographyLabel: "90027 (5 mi radius)", ratingThreshold: 4.7, targetQuantity: 10,
    });
    expect(plan.serviceMode).toBe("mobile_required");
    expect(plan.confidence).toBe("high");
  });

  it("generates mobile-specific search query variants for mobile mission text", () => {
    const plan = planMissionQuery({
      missionText: "Find me 10 mobile dog groomers near 90027.",
      category: "dog_grooming", geographyLabel: "90027 (5 mi radius)", targetQuantity: 10,
    });
    expect(plan.searchQueries.some(query => /mobile/i.test(query))).toBe(true);
    expect(plan.searchQueries.length).toBeGreaterThan(1);
  });

  it("detects building_service_required when only building-context terms are present (no explicit 'mobile')", () => {
    const plan = planMissionQuery({
      missionText: "Find dog groomers who can service residents at their building, a luxury high-rise.",
      category: "dog_grooming", geographyLabel: "90067", targetQuantity: 10,
    });
    expect(plan.serviceMode).toBe("building_service_required");
  });
});

describe("planMissionQuery -- storefront/drive-to intent", () => {
  it("detects storefront_ok and does not force mobile query variants", () => {
    const plan = planMissionQuery({
      missionText: "Find me 10 dog groomers residents can drive to near Century Park East.",
      category: "dog_grooming", geographyLabel: "90067 (5 mi radius)", targetQuantity: 10,
    });
    expect(plan.serviceMode).toBe("storefront_ok");
    expect(plan.searchQueries.every(query => !/\bmobile\b/i.test(query))).toBe(true);
  });
});

describe("planMissionQuery -- generic/no-signal mission text", () => {
  it("falls back to category+geography queries with serviceMode unknown when no signal terms are present", () => {
    const plan = planMissionQuery({
      missionText: "Find me 10 dog groomers near 90027.",
      category: "dog_grooming", geographyLabel: "90027 (5 mi radius)", targetQuantity: 10,
    });
    expect(plan.serviceMode).toBe("unknown");
    expect(plan.searchQueries).toContain("Dog Grooming near 90027");
  });

  it("treats missing mission text as low confidence, generic-only", () => {
    const plan = planMissionQuery({
      category: "dog_grooming", geographyLabel: "90027 (5 mi radius)", targetQuantity: 10,
    });
    expect(plan.serviceMode).toBe("unknown");
    expect(plan.confidence).toBe("low");
  });
});

describe("planMissionQuery -- extraction and bounds", () => {
  it("extracts the leading location token from a geographyLabel with a radius suffix, without inventing a neighborhood name", () => {
    const plan = planMissionQuery({
      missionText: "Find dog groomers near 90027.",
      category: "dog_grooming", geographyLabel: "90027 (5 mi radius)", targetQuantity: 10,
    });
    expect(plan.locationText).toBe("90027");
  });

  it("caps the number of generated query variants", () => {
    const plan = planMissionQuery({
      missionText: "Find me mobile dog groomers who service residents at their luxury high-rise building, mobile and at-home, house call, on-site.",
      category: "dog_grooming", geographyLabel: "90027 (5 mi radius)", targetQuantity: 10,
    });
    expect(plan.searchQueries.length).toBeLessThanOrEqual(MAX_QUERY_VARIANTS);
  });

  it("never produces duplicate query variants", () => {
    const plan = planMissionQuery({
      missionText: "Find me mobile dog groomers near 90027.",
      category: "dog_grooming", geographyLabel: "90027 (5 mi radius)", targetQuantity: 10,
    });
    const lowercased = plan.searchQueries.map(query => query.toLowerCase());
    expect(new Set(lowercased).size).toBe(lowercased.length);
  });

  it("does not hardcode every dog-grooming mission as mobile, and does not hardcode every one as storefront", () => {
    const mobile = planMissionQuery({ missionText: "mobile dog groomers near 90027", category: "dog_grooming", geographyLabel: "90027", targetQuantity: 10 });
    const storefront = planMissionQuery({ missionText: "dog groomers residents can drive to near 90067", category: "dog_grooming", geographyLabel: "90067", targetQuantity: 10 });
    expect(mobile.serviceMode).not.toBe(storefront.serviceMode);
  });
});

describe("planMissionQuery -- isolation", () => {
  it("never calls an LLM/AI provider -- this is a deterministic keyword module only", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "vendorMissionQueryPlanner.ts"), "utf8");
    expect(source).not.toMatch(/openai|anthropic\.|@anthropic-ai|chatCompletion|generateText|fetch\(/i);
  });

  it("never imports or calls an outreach/send adapter, and never touches truth fields", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "vendorMissionQueryPlanner.ts"), "utf8");
    expect(source).not.toMatch(/agentmail|sendVendorEmail|twilio|sendSms|elevenlabs|sendgrid/i);
    expect(source).not.toMatch(/provider_accepted|booking_confirmed|payment_authorized|\bdispatched\b/);
  });
});
