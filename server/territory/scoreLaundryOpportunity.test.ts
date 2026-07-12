import { describe, expect, it } from "vitest";
import { scoreLaundryOpportunity } from "./scoreLaundryOpportunity";

describe("scoreLaundryOpportunity", () => {
  it("ranks a nearby multi-building property account as high fit", () => {
    const result = scoreLaundryOpportunity({
      accountName: "Westview Property Management",
      demand: {
        prospectType: "property_management",
        locationCount: 15,
        estimatedWeeklyPounds: 310,
        likelyOrdersPerMonth: 8,
        hasRecurringTextileDemand: true,
        signalStrength: 88,
      },
      operatorFit: {
        commercialWashFoldEnabled: true,
        serviceRadiusMiles: 3,
        distanceMiles: 0.6,
        availableWeeklyCapacityPounds: 520,
        estimatedWeeklyPounds: 310,
        routePassesNearby: true,
        turnaroundCompatible: true,
        pickupDaysCompatible: true,
      },
      salesFit: {
        decisionMakerIdentified: true,
        contactMethodAvailable: true,
        existingProviderKnown: false,
        recentGrowthSignal: true,
        priorSimilarMissionWinRate: 0.4,
      },
      averagePricePerPoundCents: 250,
    });

    expect(result.grade).toBe("high");
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.estimatedAnnualValueCents).toBeGreaterThan(900_000);
    expect(result.reasons).toContain("Decision-maker identified");
    expect(result.risks).toContain("Current laundry provider is unknown");
  });

  it("penalizes an account outside radius and beyond capacity", () => {
    const result = scoreLaundryOpportunity({
      accountName: "Faraway Resort",
      demand: {
        prospectType: "hotel",
        locationCount: 1,
        roomCount: 140,
        hasRecurringTextileDemand: true,
        signalStrength: 30,
      },
      operatorFit: {
        commercialWashFoldEnabled: true,
        serviceRadiusMiles: 3,
        distanceMiles: 11,
        availableWeeklyCapacityPounds: 120,
        estimatedWeeklyPounds: 900,
        routePassesNearby: false,
        turnaroundCompatible: false,
        pickupDaysCompatible: false,
      },
      salesFit: {
        decisionMakerIdentified: false,
        contactMethodAvailable: false,
        existingProviderKnown: false,
        recentGrowthSignal: false,
      },
      averagePricePerPoundCents: 250,
    });

    expect(result.grade).not.toBe("high");
    expect(result.risks).toContain("Outside the configured service radius");
    expect(result.risks).toContain(
      "Estimated volume exceeds currently available weekly capacity"
    );
  });
});
