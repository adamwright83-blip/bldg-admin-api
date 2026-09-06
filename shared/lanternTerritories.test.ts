import { describe, expect, it } from "vitest";
import {
  deriveTerritoryOccupancy,
  geometryContainsPoint,
  territoryByName,
} from "./lanternTerritories";

describe("Lantern territory occupancy", () => {
  const westHollywood = territoryByName("West Hollywood")!;
  it.each(["bright", "normal", "dim", "dark"])(
    "customer presence in any %s lantern state forbids guarding",
    () => {
      const result = deriveTerritoryOccupancy({
        customers: [{ longitude: -118.3617, latitude: 34.09 }],
        totalCustomers: 1,
        atlasReady: true,
      });
      const westHollywoodOccupancy = result.territories.find(
        row => row.territory.id === "west-hollywood"
      );
      expect(westHollywoodOccupancy?.customerCount).toBe(1);
      expect(westHollywoodOccupancy?.guarded).toBe(false);
      expect(
        result.territories.filter(row => row.customerLocations.length > 0)
      ).toHaveLength(1);
    }
  );
  it("guards an authored frontier territory only when it has zero customers", () => {
    const result = deriveTerritoryOccupancy({
      customers: [],
      totalCustomers: 0,
      atlasReady: true,
    });
    expect(
      result.territories
        .filter(row => row.guarded)
        .map(row => row.territory.id)
        .sort()
    ).toEqual([
      "arts-district",
      "east-hollywood",
      "echo-park",
      "west-hollywood",
    ]);
  });
  it("suppresses zero-customer evidence when customer geography is unresolved", () => {
    expect(
      deriveTerritoryOccupancy({
        customers: [],
        totalCustomers: 3,
        atlasReady: true,
      }).suppressed
    ).toBe(true);
  });
  it("supports polygon containment", () =>
    expect(
      geometryContainsPoint(westHollywood.geometry, [-118.3617, 34.09])
    ).toBe(true));
  it("keeps the operator-authored Arts District boundary and BID reference distinct", () => {
    const artsDistrict = territoryByName("Arts District")!;
    expect(artsDistrict.sourceType).toBe("operator_authored_subterritory");
    expect(artsDistrict.parentTerritory).toBe("downtown");
    expect(artsDistrict.boundaryBasis).toBe(
      "1st St / 7th St / Alameda St / Los Angeles River"
    );
    expect(artsDistrict.referenceMetadata?.canonical).toBe(false);
  });
});
