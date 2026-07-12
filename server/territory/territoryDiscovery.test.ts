import { describe, expect, it } from "vitest";
import {
  discoverLaundryTerritory,
  distanceMiles,
  type TerritoryBusinessProvider,
} from "./territoryDiscovery";

const provider: TerritoryBusinessProvider = {
  async geocode(addressOrBusiness) {
    return {
      lat: 34.076,
      lng: -118.259,
      formattedAddress: addressOrBusiness,
    };
  },
  async searchBusinesses() {
    return [
      {
        providerId: "westview",
        name: "Westview Property Management",
        formattedAddress: "Los Angeles, CA",
        lat: 34.078,
        lng: -118.257,
        categories: ["property management"],
        locationCount: 15,
        growthSignal: "Expanded to 15 buildings",
        website: "https://example.com",
        decisionMakerName: "Dana R.",
        decisionMakerTitle: "Operations Manager",
      },
      {
        providerId: "westview",
        name: "Westview Property Management",
        formattedAddress: "Los Angeles, CA",
        lat: 34.078,
        lng: -118.257,
        categories: ["property management"],
      },
      {
        providerId: "harbor-hotel",
        name: "Harbor Inn & Suites",
        formattedAddress: "Los Angeles, CA",
        lat: 34.082,
        lng: -118.255,
        categories: ["hotel"],
        roomCount: 40,
        recentlyOpened: true,
        phone: "3235550100",
      },
    ];
  },
};

describe("territory discovery", () => {
  it("deduplicates provider results and ranks the strongest laundry fit", async () => {
    const result = await discoverLaundryTerritory({
      addressOrBusiness: "922 N Alvarado St, Los Angeles",
      provider,
      operator: {
        tenantId: "default",
        serviceRadiusMiles: 3,
        commercialWashFoldEnabled: true,
        averagePricePerPoundCents: 250,
        availableWeeklyCapacityPounds: 900,
        routePoints: [{ lat: 34.078, lng: -118.257 }],
        turnaroundCompatibleByDefault: true,
        pickupDaysCompatibleByDefault: true,
      },
      limit: 10,
    });

    expect(result.providerCandidateCount).toBe(3);
    expect(result.dedupedCandidateCount).toBe(2);
    expect(result.opportunities[0].accountName).toBe(
      "Westview Property Management"
    );
    expect(result.opportunities[0].score).toBeGreaterThanOrEqual(75);
    expect(result.evidenceByOpportunityId[result.opportunities[0].id].decisionMakerName).toBe(
      "Dana R."
    );
  });

  it("calculates realistic local distances", () => {
    const distance = distanceMiles(
      { lat: 34.076, lng: -118.259 },
      { lat: 34.086, lng: -118.249 }
    );
    expect(distance).toBeGreaterThan(0.5);
    expect(distance).toBeLessThan(2);
  });
});
