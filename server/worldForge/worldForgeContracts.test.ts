import { describe, expect, it } from "vitest";
import { canTransitionTowerForge, generateWeaponCandidates, selectPlaceCandidate } from "./worldForgeContracts";

const place = (id: string, name: string, address: string) => ({
  provider: "google_places" as const,
  placeId: id,
  businessName: name,
  rating: null,
  reviewCount: null,
  address,
  website: null,
  phone: null,
  coordinates: null,
  sourceUrl: `https://maps.example/${id}`,
});

describe("durable tower forge", () => {
  it("rejects skipped and backward state transitions", () => {
    expect(canTransitionTowerForge("captured", "entity_resolving")).toBe(true);
    expect(canTransitionTowerForge("captured", "published")).toBe(false);
    expect(canTransitionTowerForge("published", "rendering")).toBe(false);
  });

  it("requires review when Places candidates are ambiguous", () => {
    const result = selectPlaceCandidate({
      propertyName: "Century Park East",
      addressClue: "Century Park East Los Angeles",
      candidates: [
        place("2170", "Century Park East", "2170 Century Park East Los Angeles CA"),
        place("2160", "Century Park East", "2160 Century Park East Los Angeles CA"),
      ],
    });
    expect(result.status).toBe("needs_review");
  });

  it("derives concepts only from evidence and honors creative exclusions", () => {
    const concepts = generateWeaponCandidates({
      evidence: [
        { id: "pool", factType: "amenity", value: "rooftop pool", provenance: "official_property_source", sourceReference: "official:1" },
        { id: "billiards", factType: "amenity", value: "billiards lounge", provenance: "operator_observed", sourceReference: "journal:1" },
      ],
      excludedThemes: ["pool"],
      existingThemes: ["golf club"],
    });
    expect(concepts).toHaveLength(1);
    expect(concepts[0].sourceEvidenceIds).toEqual(["billiards"]);
    expect(JSON.stringify(concepts)).not.toContain("missile");
  });
});
