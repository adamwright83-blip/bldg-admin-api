import { describe, expect, it } from "vitest";
import { buildingFromSlug, matchBuilding, resolveBuildingEvidence } from "./buildings";

describe("building evidence resolution", () => {
  it("keeps a known OPUS order on OPUS", () => {
    const { building, conflict } = resolveBuildingEvidence("3545 Wilshire Blvd", "opusla");
    expect(building?.id).toBe("opus_la");
    expect(conflict).toBeNull();
  });

  it("keeps a known Century Park East order on Century Park East", () => {
    const { building, conflict } = resolveBuildingEvidence(
      "2170 Century Park East, Los Angeles, CA 90067",
      "centuryparkeast"
    );
    expect(building?.id).toBe("century_park_east");
    expect(conflict).toBeNull();
  });

  it("does not let a stale slug silently award the wrong tower", () => {
    // The shape found on 14 paid production orders: OPUS slug, CPE address.
    const { building, conflict } = resolveBuildingEvidence(
      "2170 Century Park East, Los Angeles, CA 90067",
      "opusla"
    );
    expect(building?.id).toBe("century_park_east");
    expect(conflict).toEqual({ slugBuilding: "opus_la", addressBuilding: "century_park_east" });
  });

  it("reports the contradiction in both directions", () => {
    const { building, conflict } = resolveBuildingEvidence("3545 Wilshire Blvd", "centuryparkeast");
    expect(building?.id).toBe("opus_la");
    expect(conflict).toEqual({ slugBuilding: "century_park_east", addressBuilding: "opus_la" });
  });

  it("still uses the slug when the address identifies no building", () => {
    expect(matchBuilding("742 Evergreen Terrace")).toBeUndefined();
    const { building, conflict } = resolveBuildingEvidence("742 Evergreen Terrace", "opusla");
    expect(building?.id).toBe("opus_la");
    expect(conflict).toBeNull();
  });

  it("resolves slug aliases and leaves unknown slugs to the address", () => {
    expect(buildingFromSlug("cpe-north")?.id).toBe("century_park_east");
    expect(buildingFromSlug("3650")).toBeUndefined();
    expect(resolveBuildingEvidence("3545 Wilshire Blvd", "3650").building?.id).toBe("opus_la");
  });

  it("resolves nothing when neither slug nor address identifies a building", () => {
    expect(resolveBuildingEvidence("742 Evergreen Terrace", null).building).toBeUndefined();
  });
});
