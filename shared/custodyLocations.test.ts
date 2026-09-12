import { describe, expect, it } from "vitest";
import {
  custodyLocationFromEvidence,
  custodyLocationFromFieldRow,
  nextCustodyLocation,
  previousCustodyLocation,
} from "./custodyLocations";

describe("custodyLocations", () => {
  it("cycles forward through car → coast → paragon → closet → car", () => {
    expect(nextCustodyLocation("vehicle")).toBe("coast_1hr");
    expect(nextCustodyLocation("coast_1hr")).toBe("paragon");
    expect(nextCustodyLocation("paragon")).toBe("home_closet");
    expect(nextCustodyLocation("home_closet")).toBe("vehicle");
    expect(previousCustodyLocation("vehicle")).toBe("home_closet");
    expect(previousCustodyLocation("coast_1hr")).toBe("vehicle");
  });

  it("reads explicit custody locations from order evidence", () => {
    expect(
      custodyLocationFromEvidence("AT_PROCESSOR", {
        custodyLocation: "paragon",
      })
    ).toBe("paragon");
    expect(
      custodyLocationFromEvidence("IN_VEHICLE_PROCESSED", {
        custodyLocation: "home_closet",
      })
    ).toBe("home_closet");
  });

  it("falls back to coast for legacy processor custody without a location", () => {
    expect(custodyLocationFromEvidence("AT_PROCESSOR", {})).toBe("coast_1hr");
  });

  it("maps field cargo rows through vehicle state and location", () => {
    expect(
      custodyLocationFromFieldRow({
        vehicleState: "AT_PROCESSOR",
        location: "paragon",
      })
    ).toBe("paragon");
    expect(
      custodyLocationFromFieldRow({
        vehicleState: "IN_VEHICLE",
        location: null,
      })
    ).toBe("vehicle");
  });
});
