import { describe, expect, it } from "vitest";
import {
  canonicalTowerIdForHandoff,
  matchBuilding,
  resolvePortalHandoffBuildingSlug,
} from "./buildings";

describe("canonicalTowerIdForHandoff", () => {
  it("returns numeric tower ids for CPE addresses", () => {
    expect(
      canonicalTowerIdForHandoff("2170 Century Park E, Los Angeles, CA 90067", "centuryparkeast")
    ).toBe("2170");
    expect(
      canonicalTowerIdForHandoff("2160 Century Park East, Los Angeles, CA 90067", null)
    ).toBe("2160");
  });

  it("returns numeric tower ids for Opus addresses", () => {
    expect(
      canonicalTowerIdForHandoff("3545 Wilshire Blvd, Los Angeles, CA 90010", "opusla")
    ).toBe("3545");
    expect(
      canonicalTowerIdForHandoff("3650 S 6th St, Los Angeles, CA 90010", "opusla")
    ).toBe("3650");
  });

  it("maps north/south legacy slugs to tower ids", () => {
    expect(canonicalTowerIdForHandoff("x", "centuryparkeastnorth")).toBe("2160");
    expect(canonicalTowerIdForHandoff("x", "centuryparkeastsouth")).toBe("2170");
  });

  it("returns null for campus-level CPE slug without street number", () => {
    expect(
      canonicalTowerIdForHandoff("Century Park East, Los Angeles, CA", "centuryparkeast")
    ).toBeNull();
  });

  it("alias resolvePortalHandoffBuildingSlug matches canonicalTowerIdForHandoff", () => {
    expect(resolvePortalHandoffBuildingSlug("3545 Wilshire", null)).toBe(
      canonicalTowerIdForHandoff("3545 Wilshire", null)
    );
  });
});

describe("matchBuilding", () => {
  it("does not match street number inside longer numerals", () => {
    expect(matchBuilding("13545 Wilshire Blvd")).toBeUndefined();
  });

  it("matches 3545 wilshire", () => {
    expect(matchBuilding("3545 Wilshire Blvd, Los Angeles, CA")?.slug).toBe("3545");
  });
});
