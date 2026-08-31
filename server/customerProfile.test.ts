import { describe, expect, it } from "vitest";
import { deriveBuildingSlug } from "./customerProfile";

describe("customer profile building attribution", () => {
  it("keeps an uncontradicted OPUS record on OPUS", () => {
    expect(deriveBuildingSlug({ buildingSlug: "opusla", address: "3545 Wilshire Blvd" })).toBe("opusla");
  });

  it("keeps an uncontradicted Century Park East record on Century Park East", () => {
    expect(
      deriveBuildingSlug({ buildingSlug: "centuryparkeast", address: "2170 Century Park East, Los Angeles, CA 90067" })
    ).toBe("centuryparkeast");
  });

  it("does not show a building the record's own address contradicts", () => {
    // The shape behind the observed "Building opusla" on a CPE resident.
    expect(
      deriveBuildingSlug({ buildingSlug: "opusla", address: "2170 Century Park East, Los Angeles, CA 90067" })
    ).toBe("centuryparkeast");
  });

  it("still uses the slug when the address names no building", () => {
    expect(deriveBuildingSlug({ buildingSlug: "opusla", address: "742 Evergreen Terrace" })).toBe("opusla");
  });

  it("resolves nothing when neither source names a building", () => {
    expect(deriveBuildingSlug({ buildingSlug: null, address: "742 Evergreen Terrace" })).toBeNull();
  });
});
