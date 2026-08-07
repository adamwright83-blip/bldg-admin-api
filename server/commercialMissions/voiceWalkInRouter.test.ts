import { describe, expect, it } from "vitest";
import { chooseWalkInPlace } from "./voiceWalkInRouter";
import type { NormalizedPlaceCandidate } from "../procurement/googlePlacesDiscoveryConnector";

function place(name: string, address: string): NormalizedPlaceCandidate {
  return {
    provider: "google_places",
    placeId: name.toLowerCase().replace(/\W+/g, "-"),
    businessName: name,
    rating: null,
    reviewCount: null,
    address,
    website: null,
    phone: null,
    coordinates: null,
    sourceUrl: "https://maps.google.com/",
  };
}

describe("chooseWalkInPlace", () => {
  it("treats an exact normalized building-name match as high confidence", () => {
    const result = chooseWalkInPlace("The Louise", [
      place("Louise Apartments", "Wrong address"),
      place("The Louise", "1633 N Edgemont St, Los Angeles, CA"),
    ]);
    expect(result.confidence).toBe("high");
    expect(result.candidate?.address).toContain("Edgemont");
  });

  it("does not pretend an unrelated first result is high confidence", () => {
    const result = chooseWalkInPlace("The Louise", [place("Louise's Trattoria", "Los Angeles, CA")]);
    expect(result.confidence).toBe("medium");
  });

  it("returns no candidate honestly when Places returns nothing", () => {
    expect(chooseWalkInPlace("The Louise", [])).toEqual({ candidate: null, confidence: "none" });
  });
});
