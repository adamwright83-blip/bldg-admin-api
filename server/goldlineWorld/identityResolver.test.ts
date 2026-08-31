import { describe, expect, it } from "vitest";
import { resolvePhysicalIdentity, type PhysicalIdentityCandidate } from "./identityResolver";

const candidates: PhysicalIdentityCandidate[] = [
  {
    physicalEntityId: "cpe-2170",
    displayName: "Century Park East",
    googlePlaceId: "place-2170",
    canonicalAddress: "2170 Century Park East, Los Angeles, CA 90067",
    aliases: ["2170 Century Park E Los Angeles CA 90067"],
  },
  {
    physicalEntityId: "cpe-2160",
    displayName: "Century Park East",
    googlePlaceId: "place-2160",
    canonicalAddress: "2160 Century Park East, Los Angeles, CA 90067",
    aliases: [],
  },
];

describe("physical entity resolution", () => {
  it("resolves repeated provider identity to the same save file", () => {
    expect(resolvePhysicalIdentity({ googlePlaceId: "place-2170" }, candidates)).toMatchObject({
      status: "matched",
      physicalEntityId: "cpe-2170",
      reason: "google_place_id",
    });
  });

  it("resolves a safe canonical-address match", () => {
    expect(resolvePhysicalIdentity({ canonicalAddress: "2170 Century Park East, Los Angeles CA 90067" }, candidates)).toMatchObject({
      status: "matched",
      physicalEntityId: "cpe-2170",
    });
  });

  it("keeps 2170 and 2160 Century Park East distinct", () => {
    const first = resolvePhysicalIdentity({ canonicalAddress: "2170 Century Park East, Los Angeles, CA 90067" }, candidates);
    const second = resolvePhysicalIdentity({ canonicalAddress: "2160 Century Park East, Los Angeles, CA 90067" }, candidates);
    expect(first.status === "matched" && first.physicalEntityId).toBe("cpe-2170");
    expect(second.status === "matched" && second.physicalEntityId).toBe("cpe-2160");
  });

  it("never merges on a shared building name alone", () => {
    expect(resolvePhysicalIdentity({ displayName: "Century Park East" }, candidates)).toEqual({
      status: "needs_review",
      candidateIds: ["cpe-2170", "cpe-2160"],
      reason: "name-only identity is ambiguous",
    });
  });
});
