import { describe, expect, it } from "vitest";
import { discoverLaundryTerritory, distanceMiles, type TerritoryBusinessProvider } from "./territoryDiscovery";

const provider: TerritoryBusinessProvider = {
  name: "fixture",
  async geocode(address) { return { lat: 34.076, lng: -118.259, formattedAddress: address }; },
  async searchBusinesses() {
    const sourceCapturedAt = "2026-07-13T00:00:00.000Z";
    return [
      { providerId: "westview", providerName: "fixture", providerUrl: "https://maps.example/westview", sourceCapturedAt, name: "Westview Property Management", formattedAddress: "Los Angeles, CA", lat: 34.078, lng: -118.257, categories: ["property management"], locationCount: 15, growthSignal: "Expanded to 15 buildings", website: "https://example.com", decisionMakerName: "Dana R.", decisionMakerTitle: "Operations Manager" },
      { providerId: "westview", providerName: "fixture", providerUrl: null, sourceCapturedAt, name: "Westview Property Management", formattedAddress: "Los Angeles, CA", lat: 34.078, lng: -118.257, categories: ["property management"] },
      { providerId: "harbor", providerName: "fixture", providerUrl: null, sourceCapturedAt, name: "Harbor Inn", formattedAddress: "Los Angeles, CA", lat: 34.082, lng: -118.255, categories: ["hotel"], roomCount: 40, phone: "3235550100" },
    ];
  },
};

describe("territory discovery", () => {
  it("deduplicates, ranks, and classifies evidence provenance", async () => {
    const result = await discoverLaundryTerritory({
      addressOrBusiness: "922 N Alvarado St, Los Angeles",
      provider,
      operator: { tenantId: "default", serviceRadiusMiles: 3, commercialWashFoldEnabled: true, averagePricePerPoundCents: 250, availableWeeklyCapacityPounds: 900, routePoints: [{ lat: 34.078, lng: -118.257 }], turnaroundCompatibleByDefault: true, pickupDaysCompatibleByDefault: true },
      limit: 10,
    });
    expect(result.providerCandidateCount).toBe(3);
    expect(result.dedupedCandidateCount).toBe(2);
    expect(result.opportunities[0]?.account.name).toBe("Westview Property Management");
    expect(result.opportunities[0]?.evidence.map(item => item.classification)).toEqual([
      "sourced_fact", "operator_input", "deterministic_estimate",
    ]);
    expect(result.opportunities[0]?.account.decisionMaker.name).toBe("Dana R.");
  });

  it("calculates realistic local distances", () => {
    const distance = distanceMiles({ lat: 34.076, lng: -118.259 }, { lat: 34.086, lng: -118.249 });
    expect(distance).toBeGreaterThan(0.5);
    expect(distance).toBeLessThan(2);
  });
});
