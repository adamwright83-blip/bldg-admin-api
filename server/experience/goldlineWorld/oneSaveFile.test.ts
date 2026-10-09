import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizePhysicalAlias,
  physicalAliasKeys,
  physicalAliasesMatch,
  resolvePhysicalIdentity,
  type PhysicalIdentityCandidate,
} from "./identityResolver";

const louise: PhysicalIdentityCandidate = {
  physicalEntityId: "building-louise",
  displayName: "The Louise",
  googlePlaceId: "places/proof-louise",
  canonicalAddress: "1450 S La Cienega Blvd, Los Angeles, CA",
  aliases: [],
};

describe("one building keeps one save file", () => {
  it("folds the ways a real address gets written", () => {
    const canonical = normalizePhysicalAlias("1450 S La Cienega Blvd");
    expect(normalizePhysicalAlias("1450 South La Cienega Boulevard")).toBe(canonical);
    expect(normalizePhysicalAlias("1450 S. La Cienega Blvd.")).toBe(canonical);
    // A unit is a space inside the building, not a different building.
    expect(normalizePhysicalAlias("1450 S La Cienega Blvd Apt 4")).toBe(canonical);
    expect(normalizePhysicalAlias("1450 S La Cienega Blvd #12")).toBe(canonical);
    expect(normalizePhysicalAlias("1450 S La Cienega Blvd, Suite 200")).toBe(canonical);
  });

  it("splits the doorway from the locality that may or may not be written", () => {
    const keys = physicalAliasKeys("1450 S La Cienega Blvd, Los Angeles, CA");
    expect(keys.street).toBe("1450 s la cienega blvd");
    expect(keys.locality).toBe("los angeles ca");
  });

  it("matches a reference that omits the city with one that includes it", () => {
    expect(
      physicalAliasesMatch(
        "1450 S La Cienega Blvd, Los Angeles, CA",
        "1450 South La Cienega Boulevard"
      )
    ).toBe(true);
  });

  it("never merges different doorways", () => {
    // These are the failures that would be far worse than a missed dedupe.
    expect(physicalAliasesMatch("1450 S La Cienega Blvd", "1451 S La Cienega Blvd")).toBe(false);
    expect(physicalAliasesMatch("1450 S La Cienega Blvd", "1450 N La Cienega Blvd")).toBe(false);
    expect(physicalAliasesMatch("1450 S La Cienega Blvd", "1450 S Robertson Blvd")).toBe(false);
    expect(
      physicalAliasesMatch("1450 Main St, Pasadena CA", "1450 Main St, Burbank CA")
    ).toBe(false);
    expect(physicalAliasesMatch("", "1450 S La Cienega Blvd")).toBe(false);
    expect(
      physicalAliasesMatch(
        "1520 S La Cienega Blvd, Los Angeles, CA",
        "1520 S La Cienega Blvd"
      )
    ).toBe(true);
  });

  it("resolves a natural address variation to the same physical entity", () => {
    // This is the regression that would create a second tower for one building.
    const resolution = resolvePhysicalIdentity(
      { addressClue: "1450 South La Cienega Boulevard, Apt 3" },
      [louise]
    );
    expect(resolution.status).toBe("matched");
    expect(resolution.status === "matched" && resolution.physicalEntityId).toBe(
      "building-louise"
    );
  });

  it("still creates a new entity for a genuinely different address", () => {
    const resolution = resolvePhysicalIdentity(
      { addressClue: "800 W Olympic Blvd" },
      [louise]
    );
    expect(resolution.status).toBe("new_entity");
  });

  it("refuses to pick a winner when an address is bound to two entities", () => {
    const twin: PhysicalIdentityCandidate = {
      ...louise,
      physicalEntityId: "building-twin",
      googlePlaceId: "places/proof-twin",
    };
    const resolution = resolvePhysicalIdentity(
      { addressClue: "1450 S La Cienega Blvd" },
      [louise, twin]
    );
    expect(resolution.status).toBe("needs_review");
  });

  it("keeps provider identity ahead of any address spelling", () => {
    const resolution = resolvePhysicalIdentity(
      { googlePlaceId: "places/proof-louise", addressClue: "somewhere else entirely" },
      [louise]
    );
    expect(resolution.status === "matched" && resolution.reason).toBe("google_place_id");
  });

  it("treats a name alone as ambiguous rather than as identity", () => {
    const resolution = resolvePhysicalIdentity({ displayName: "The Louise" }, [louise]);
    expect(resolution.status).toBe("needs_review");
  });
});

describe("a second journal about the same place cannot fork the save file", () => {
  const forge = readFileSync(
    join(__dirname, "../worldForge/worldForgeService.ts"),
    "utf8"
  );

  it("reuses the commercial account already bound to the building", () => {
    /*
      Without this, every journal about one property opened another commercial
      account, which produced another geographic authority row and eventually
      another publishable tower for a single real building.
    */
    expect(forge).toContain('eq(physicalEntityBindings.bindingType, "commercial_account")');
    expect(forge).toContain("boundAccountId");
    expect(forge).toMatch(/boundAccountId && Number\.isSafeInteger\(boundAccountId\)/);
  });

  it("keeps at most one approved tower per physical entity", () => {
    // Publishing supersedes the previous approved asset for the same entity
    // rather than adding a second canonical tower beside it.
    expect(forge).toContain('approvalStatus: "superseded"');
    expect(forge).toContain("eq(towerAssetVersions.physicalEntityId, job.physicalEntityId)");
    expect(forge).toContain('eq(towerAssetVersions.approvalStatus, "approved")');
  });

  it("publishes a representation without claiming the account was won", () => {
    expect(forge).toContain('eventType: "tower_published"');
    expect(forge).toContain('classification: "game_projection"');
    expect(forge).toContain('provenanceClass: "generated_game_fiction"');
    expect(forge).toContain("representationOnly: true");
  });

  it("refuses a test-only image adapter in production", () => {
    expect(forge).toContain(
      'generated.provider === "deterministic_test_only" && process.env.NODE_ENV === "production"'
    );
  });
});
