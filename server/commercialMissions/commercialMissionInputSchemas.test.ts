import { describe, expect, it } from "vitest";
import {
  commercialMissionAccountInputSchema,
  commercialMissionOpportunityInputSchema,
  commercialMissionStepInputSchema,
  commercialMissionStepsInputSchema,
} from "./commercialMissionRouter";

describe("commercial mission input schemas", () => {
  it("accepts the complete contact contract without requiring coordinates or an estimate", () => {
    const account = commercialMissionAccountInputSchema.parse({
      name: "Maybourne Beverly Hills",
      accountType: "luxury_hotel",
      website: "https://www.maybournebeverlyhills.com",
      address: "225 N Canon Dr, Beverly Hills, CA 90210",
      latitude: null,
      longitude: null,
      locationCount: 1,
      decisionMaker: {
        name: "Vincent",
        title: "Concierge",
        email: "vincent@example.com",
        phone: "+1 310 555 0188",
        relationshipType: "concierge",
        preferredChannel: "email",
        source: "unplanned_walk_in",
        sourceUrl: null,
        sourcedAt: "2026-07-23T12:00:00.000Z",
        notes: "Asked about turnaround.",
      },
    });
    const opportunity = commercialMissionOpportunityInputSchema.parse({
      estimatedAnnualValueCents: null,
      estimateConfidence: "low",
      score: 0,
      primarySignal: "Unplanned walk-in; qualification is pending",
      reasons: [],
      risks: ["Annual value has not been estimated"],
      evidence: [{ source: "operator_observation" }],
    });

    expect(account.decisionMaker.email).toBe("vincent@example.com");
    expect(opportunity.estimatedAnnualValueCents).toBeNull();
  });

  it("round-trips the complete IRL companion contract", () => {
    const parsed = commercialMissionStepInputSchema.parse({
      key: "wardrobe",
      label: "Look sharp",
      detail: "Submit a parked, private wardrobe photo for review.",
      type: "wardrobe_review",
      status: "active",
      position: 0,
      instructionText: "Match the approved professional reference.",
      revealPolicy: "sequential",
      destinationName: null,
      destinationAddress: null,
      destinationLatitude: null,
      destinationLongitude: null,
      mapsUrl: null,
      countdownDurationSeconds: 900,
      proofRequirement: "photo",
      referenceImageUrl: "https://assets.example.com/wardrobe.webp",
      instructionVideoUrl: "https://assets.example.com/wardrobe.mp4",
      fulfillmentMode: "not_applicable",
      metadata: { scene: "wardrobe", haptic: "objective_reveal" },
    });

    expect(parsed.type).toBe("wardrobe_review");
    expect(parsed.metadata).toEqual({
      scene: "wardrobe",
      haptic: "objective_reveal",
    });
  });

  it("rejects forged server-owned proof and review truth at mission creation", () => {
    expect(
      commercialMissionStepInputSchema.safeParse({
        key: "wardrobe",
        label: "Look sharp",
        detail: "Submit a wardrobe photo.",
        type: "wardrobe_review",
        status: "awaiting_review",
        position: 0,
        proofRequirement: "photo",
        verificationState: "approved",
        proofAssetId: "20db5ef0-0359-4c72-abdd-a25182110798",
        reviewedBy: "attacker",
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate step keys and positions", () => {
    const step = {
      key: "first",
      label: "First",
      detail: "First objective",
      status: "ready" as const,
      position: 0,
    };
    expect(
      commercialMissionStepsInputSchema.safeParse([
        step,
        { ...step, key: "second" },
      ]).success,
    ).toBe(false);
    expect(
      commercialMissionStepsInputSchema.safeParse([
        step,
        { ...step, position: 1 },
      ]).success,
    ).toBe(false);
  });

  it("rejects malformed contact data, non-HTTP URLs, partial coordinates, and oversized timers", () => {
    expect(
      commercialMissionAccountInputSchema.safeParse({
        name: "Hotel",
        accountType: "hotel",
        address: "1 Main St",
        latitude: null,
        longitude: null,
        locationCount: 1,
        decisionMaker: {
          name: "Vincent",
          title: "Concierge",
          email: "not-an-email",
          sourceUrl: "https://hotel.example/team",
        },
      }).success,
    ).toBe(false);
    expect(
      commercialMissionAccountInputSchema.safeParse({
        name: "Hotel",
        accountType: "hotel",
        address: "1 Main St",
        latitude: null,
        longitude: null,
        locationCount: 1,
        decisionMaker: {
          name: "Vincent",
          title: "Concierge",
          email: "vincent@example.com",
          sourceUrl: "javascript:alert(1)",
        },
      }).success,
    ).toBe(false);
    expect(
      commercialMissionAccountInputSchema.safeParse({
        name: "Hotel",
        accountType: "hotel",
        address: "1 Main St",
        latitude: 34.0,
        longitude: null,
        locationCount: 1,
        decisionMaker: { name: null, title: null },
      }).success,
    ).toBe(false);
    expect(
      commercialMissionStepInputSchema.safeParse({
        key: "timer",
        label: "Timer",
        detail: "Move when parked.",
        status: "ready",
        position: 1,
        countdownDurationSeconds: 86_401,
      }).success,
    ).toBe(false);
  });
});
