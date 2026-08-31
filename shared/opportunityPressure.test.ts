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

  it("ensures canonical customer count remains independently sourced", () => {
    const projection = computeOpportunityPressure({
      districts: [],
      source: "baseline_density",
    });

    for (const district of projection.districts) {
      expect(district.goldlineCustomerCount).toBe(0);
      expect(district.multiFamilyDensityCount).toBeGreaterThan(0);
    }
  });
});
