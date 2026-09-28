import { describe, expect, it } from "vitest";
import {
  resolveDriverMissionTargets,
  type DriverMissionPlacesProvider,
} from "./commercialMissionBuilderService";
import type {
  LaundryTerritoryOperatorContext,
  TerritoryBusinessCandidate,
} from "../territory/territoryDiscovery";

const operator: LaundryTerritoryOperatorContext = {
  tenantId: "tenant-a",
  serviceRadiusMiles: 5,
  commercialWashFoldEnabled: true,
  averagePricePerPoundCents: 225,
  availableWeeklyCapacityPounds: 2_000,
  routePoints: [],
  turnaroundCompatibleByDefault: true,
  pickupDaysCompatibleByDefault: true,
};

const losFelizTowers: TerritoryBusinessCandidate = {
  providerId: "places/los-feliz-towers",
  providerName: "google_places",
  providerUrl: "https://maps.google.com/?cid=los-feliz-towers",
  sourceCapturedAt: "2026-09-27T12:00:00.000Z",
  name: "Los Feliz Towers",
  formattedAddress: "4455 Los Feliz Blvd, Los Angeles, CA 90027, USA",
  lat: 34.1126,
  lng: -118.287,
  categories: ["apartment_complex", "establishment"],
  website: null,
  phone: "(323) 555-0100",
};

function exactProvider(
  resolved: TerritoryBusinessCandidate | null
): DriverMissionPlacesProvider {
  return {
    name: "google_places",
    async resolveBusiness() {
      return resolved;
    },
    async geocode() {
      throw new Error("Exact-property mode must not enter territory geocoding.");
    },
    async searchBusinesses() {
      throw new Error("Exact-property mode must not enter nearby discovery.");
    },
  };
}

describe("driver mission target resolution", () => {
  it("turns the Los Feliz Towers exact address into one target and never nearby discovery", async () => {
    const result = await resolveDriverMissionTargets({
      targetMode: "exact_property",
      searchNear: "4455 Los Feliz Blvd, Los Angeles, CA 90027",
      venueType: "luxury_living",
      count: 3,
      operator,
      places: exactProvider(losFelizTowers),
    });

    expect(result.exactTarget?.providerId).toBe(losFelizTowers.providerId);
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0]?.providerAccountId).toBe(
      losFelizTowers.providerId
    );
    expect(result.opportunities[0]?.account.name).toBe("Los Feliz Towers");
  });

  it("resolves an exact place name plus city as one target", async () => {
    const result = await resolveDriverMissionTargets({
      targetMode: "exact_property",
      searchNear: "Los Feliz Towers, Los Angeles",
      venueType: "luxury_living",
      count: 3,
      operator,
      places: exactProvider(losFelizTowers),
    });

    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0]?.account.address).toContain(
      "4455 Los Feliz Blvd"
    );
  });


  it("uses the selected Google Place ID as the exact-property authority", async () => {
    const provider: DriverMissionPlacesProvider = {
      name: "google_places",
      async resolveBusiness() {
        throw new Error("Selected Place ID must bypass free-text resolution.");
      },
      async resolveBusinessByPlaceId(placeId: string) {
        expect(placeId).toBe("los-feliz-towers");
        return losFelizTowers;
      },
      async geocode() {
        throw new Error("Selected Place ID must not enter territory geocoding.");
      },
      async searchBusinesses() {
        throw new Error("Selected Place ID must not enter nearby discovery.");
      },
    };

    const result = await resolveDriverMissionTargets({
      targetMode: "exact_property",
      searchNear:
        "Los Feliz Towers, 4455 Los Feliz Blvd, Los Angeles, CA 90027",
      placeId: "los-feliz-towers",
      venueType: "luxury_living",
      count: 3,
      operator,
      places: provider,
    });

    expect(result.exactTarget?.providerId).toBe(losFelizTowers.providerId);
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0]?.account.name).toBe("Los Feliz Towers");
  });

  it("fails closed when an exact property cannot be identified", async () => {
    await expect(
      resolveDriverMissionTargets({
        targetMode: "exact_property",
        searchNear: "4455 Imaginary Blvd, Los Angeles, CA 90027",
        venueType: "luxury_living",
        count: 3,
        operator,
        places: exactProvider(null),
      })
    ).rejects.toThrow("Could not identify this property");
  });

  it("still performs territory discovery only when nearby mode is explicit", async () => {
    let exactLookupCalled = false;
    const provider: DriverMissionPlacesProvider = {
      name: "google_places",
      async resolveBusiness() {
        exactLookupCalled = true;
        return losFelizTowers;
      },
      async geocode() {
        return {
          lat: 34.1126,
          lng: -118.287,
          formattedAddress: "Los Feliz, Los Angeles, CA, USA",
        };
      },
      async searchBusinesses() {
        return [
          losFelizTowers,
          {
            ...losFelizTowers,
            providerId: "places/other-apartment",
            name: "Other Apartment",
            formattedAddress: "4500 Los Feliz Blvd, Los Angeles, CA 90027, USA",
            lat: 34.113,
            lng: -118.286,
          },
        ];
      },
    };

    const result = await resolveDriverMissionTargets({
      targetMode: "nearby_discovery",
      searchNear: "Los Feliz, Los Angeles",
      venueType: "luxury_living",
      count: 3,
      operator,
      places: provider,
    });

    expect(exactLookupCalled).toBe(false);
    expect(result.exactTarget).toBeNull();
    expect(result.opportunities).toHaveLength(2);
  });
});
