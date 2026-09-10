import { describe, expect, it } from "vitest";
import { cargoDisplayName } from "./GarmentBagSprite";
import type { VehicleCargoItem } from "./VehicleCargo";

const base: VehicleCargoItem = {
  id: 1,
  state: "IN_VEHICLE_PROCESSED",
  appearance: {
    kind: "garment_bag",
    condition: "covered garments",
    next: "Customer return",
  },
};

describe("cargoDisplayName — real names only, never fabricated", () => {
  it("prefers the explicit customerDisplayName (field cargo)", () => {
    expect(
      cargoDisplayName({ ...base, customerDisplayName: "Yazi Kim" })
    ).toBe("Yazi Kim");
  });

  it("composes firstName + lastName for order-sourced cargo", () => {
    expect(
      cargoDisplayName({ ...base, firstName: "Avery", lastName: "Stone" })
    ).toBe("Avery Stone");
  });

  it("handles a first-name-only record without a trailing space", () => {
    expect(cargoDisplayName({ ...base, firstName: "Morgan" })).toBe("Morgan");
  });

  it("handles a last-name-only record", () => {
    expect(cargoDisplayName({ ...base, lastName: "Pike" })).toBe("Pike");
  });

  it("trims incidental whitespace on customerDisplayName", () => {
    expect(
      cargoDisplayName({ ...base, customerDisplayName: "  Riley Vale  " })
    ).toBe("Riley Vale");
  });

  it("returns null — never a fabricated placeholder — when no name data exists", () => {
    expect(cargoDisplayName({ ...base })).toBeNull();
    expect(
      cargoDisplayName({ ...base, firstName: null, lastName: null })
    ).toBeNull();
    expect(cargoDisplayName({ ...base, customerDisplayName: "" })).toBeNull();
    expect(
      cargoDisplayName({ ...base, firstName: "  ", lastName: "  " })
    ).toBeNull();
  });
});
