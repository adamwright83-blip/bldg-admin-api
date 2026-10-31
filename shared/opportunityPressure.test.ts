import { describe, expect, it } from "vitest";
import {
  computeOpportunityPressure,
  STRATEGIC_LA_DISTRICTS,
} from "./opportunityPressure";

describe("Places Aggregate — Territory Opportunity Pressure", () => {
  it("projects opportunity density without synthesizing fake accounts", () => {
    const projection = computeOpportunityPressure({
      districts: [
        { districtId: "koreatown", housingCount: 300, activeCustomerCount: 25 },
        { districtId: "century_city", housingCount: 150, activeCustomerCount: 15 },
        { districtId: "west_hollywood", housingCount: 250, activeCustomerCount: 0 },
      ],
      source: "places_aggregate",
    });

    expect(projection.districts.length).toBe(STRATEGIC_LA_DISTRICTS.length);
    expect(projection.source).toBe("places_aggregate");

    const weho = projection.districts.find(d => d.districtId === "west_hollywood");
    expect(weho).toBeDefined();
    expect(weho?.opportunityPressure).toBe("unexplored");
    expect(weho?.goldlineCustomerCount).toBe(0);

    const ktown = projection.districts.find(d => d.districtId === "koreatown");
    expect(ktown?.opportunityPressure).toBe("high_potential");
    expect(ktown?.goldlineCustomerCount).toBe(25);
  });

  it("never manufactures a building count or a customer count it doesn't have", () => {
    const projection = computeOpportunityPressure({ districts: [], source: "baseline_density" });

    for (const district of projection.districts) {
      // before: an absent count became 50 buildings and "unexplored" with a glow
      expect(district.multiFamilyDensityCount).toBeNull();
      expect(district.goldlineCustomerCount).toBeNull();
      expect(district.penetrationRatio).toBeNull();
      expect(district.opportunityPressure).toBe("unknown");
      expect(district.intensityScore).toBe(0);
    }
    expect(projection.totalHousingCount).toBe(0);
    expect(projection.unknownHousingDistrictCount).toBe(STRATEGIC_LA_DISTRICTS.length);
    expect(projection.unexploredDistrictCount).toBe(0);
  });

  it("an unknown count stays unknown while the known districts still project", () => {
    const projection = computeOpportunityPressure({
      districts: [
        { districtId: "koreatown", housingCount: null, activeCustomerCount: 4 },
        { districtId: "silver_lake", housingCount: 31, activeCustomerCount: 2 },
      ],
      source: "places_aggregate",
    });
    const ktown = projection.districts.find(d => d.districtId === "koreatown")!;
    expect(ktown.multiFamilyDensityCount).toBeNull();
    expect(ktown.opportunityPressure).toBe("unknown");
    const silver = projection.districts.find(d => d.districtId === "silver_lake")!;
    expect(silver.multiFamilyDensityCount).toBe(31);
    expect(silver.penetrationRatio).toBeCloseTo(2 / 31);
    expect(silver.opportunityPressure).toBe("high_potential");
    expect(projection.totalHousingCount).toBe(31);
  });

  it("unknown customer presence is never read as 'no customers here'", () => {
    const projection = computeOpportunityPressure({
      districts: [{ districtId: "echo_park", housingCount: 19, activeCustomerCount: null }],
      source: "places_aggregate",
    });
    const echo = projection.districts.find(d => d.districtId === "echo_park")!;
    expect(echo.opportunityPressure).toBe("unknown");
    expect(echo.multiFamilyDensityCount).toBe(19);
    expect(projection.unexploredDistrictCount).toBe(0);
  });

  it("a real zero is kept as zero, not raised to one", () => {
    const projection = computeOpportunityPressure({
      districts: [{ districtId: "echo_park", housingCount: 0, activeCustomerCount: 0 }],
      source: "places_aggregate",
    });
    const echo = projection.districts.find(d => d.districtId === "echo_park")!;
    expect(echo.multiFamilyDensityCount).toBe(0);
    expect(echo.penetrationRatio).toBeNull();
    expect(echo.intensityScore).toBe(0);
  });
});
