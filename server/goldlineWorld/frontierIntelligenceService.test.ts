import { describe, expect, it } from "vitest";
import type { NormalizedPlaceCandidate } from "../procurement/googlePlacesDiscoveryConnector";
import { filterCandidatesToTerritory } from "./frontierIntelligenceService";

function salon(
  placeId: string,
  lat: number,
  lng: number
): NormalizedPlaceCandidate {
  return {
    provider: "google_places",
    placeId,
    businessName: placeId,
    rating: null,
    reviewCount: null,
    address: null,
    website: null,
    phone: null,
    coordinates: { lat, lng },
    sourceUrl: `https://example.test/${placeId}`,
  };
}

describe("frontier territory intelligence", () => {
  it("hard-gates Google candidates to the canonical WGS84 territory", () => {
    const result = filterCandidatesToTerritory("west-hollywood", [
      salon("inside", 34.09, -118.3617),
      salon("outside", 34.0522, -118.2437),
    ]);
    expect(result.map(candidate => candidate.placeId)).toEqual(["inside"]);
  });

  it("rejects candidates without verified coordinates", () => {
    const candidate = salon("unknown", 34.09, -118.3617);
    candidate.coordinates = null;
    expect(filterCandidatesToTerritory("west-hollywood", [candidate])).toEqual(
      []
    );
  });
});
