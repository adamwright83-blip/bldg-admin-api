import type {
  GeoPoint,
  TerritoryBusinessCandidate,
  TerritoryBusinessProvider,
} from "../territoryDiscovery";

/**
 * Deterministic provider shared by explicitly gated release checks. It never
 * calls a network service and never represents its fixtures as live data.
 */
export class DeterministicTerritoryProvider
  implements TerritoryBusinessProvider
{
  readonly name = "dayforge-release-fixture";

  async geocode(addressOrBusiness: string): Promise<GeoPoint> {
    if (!addressOrBusiness.trim()) throw new Error("A fixture address is required");
    return {
      lat: 34.052235,
      lng: -118.243683,
      formattedAddress: "100 Release Gate Way, Los Angeles, CA 90012",
    };
  }

  async searchBusinesses(input: {
    center: GeoPoint;
    radiusMiles: number;
    categories: string[];
    limit: number;
  }): Promise<TerritoryBusinessCandidate[]> {
    if (input.radiusMiles <= 0 || input.limit <= 0) return [];
    const capturedAt = "2026-01-15T12:00:00.000Z";
    const westview: TerritoryBusinessCandidate = {
      providerId: "fixture-westview",
      providerName: this.name,
      providerUrl: null,
      sourceCapturedAt: capturedAt,
      name: "Westview Property Management",
      formattedAddress: "1420 Westview Avenue, Los Angeles, CA 90012",
      lat: input.center.lat + 0.002,
      lng: input.center.lng + 0.002,
      categories: ["property management company", "apartment complex"],
      website: "https://fixture.invalid/westview",
      phone: null,
      locationCount: 15,
      recentlyOpened: false,
      growthSignal: "Fixture portfolio expansion signal",
      decisionMakerName: "Dana R.",
      decisionMakerTitle: "Operations Manager",
    };
    return [
      westview,
      // Intentional duplicate verifies provider-level duplicates do not become
      // multiple ranked opportunities.
      { ...westview },
      {
        providerId: "fixture-harbor",
        providerName: this.name,
        providerUrl: null,
        sourceCapturedAt: capturedAt,
        name: "Harbor Fitness Club",
        formattedAddress: "200 Harbor Street, Los Angeles, CA 90012",
        lat: input.center.lat + 0.006,
        lng: input.center.lng - 0.003,
        categories: ["gym", "fitness"],
        website: null,
        phone: "+1-555-0100",
        locationCount: 2,
        recentlyOpened: true,
        growthSignal: null,
        decisionMakerName: null,
        decisionMakerTitle: null,
      },
    ].slice(0, input.limit);
  }
}
export function createDeterministicTerritoryProvider(): TerritoryBusinessProvider {
  return new DeterministicTerritoryProvider();
}
