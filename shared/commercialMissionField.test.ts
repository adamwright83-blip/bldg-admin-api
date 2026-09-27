import { describe, expect, it } from "vitest";
import {
  COMMERCIAL_MISSION_LOCATION_CHECK_IN_RADIUS_METERS,
  DEFAULT_FIELD_CHECKLIST,
  evaluateCommercialMissionLocationCheckIn,
  FIELD_OUTCOME_REASONS,
  navigationUrl,
} from "./commercialMissionField";

describe("commercial mission Field contract", () => {
  it("provides safe persisted-checklist defaults that tenants can override", () => {
    expect(DEFAULT_FIELD_CHECKLIST.map(item => item.itemKey)).toEqual([
      "clean_polo",
      "quote_sheet",
      "collateral",
      "business_cards",
    ]);
    expect(DEFAULT_FIELD_CHECKLIST.filter(item => item.required)).toHaveLength(
      3
    );
  });

  it("builds navigation without interpolating an unsafe raw address", () => {
    expect(navigationUrl("100 Main St & 2nd Ave")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=100%20Main%20St%20%26%202nd%20Ave"
    );
  });

  it("accepts authoritative location only inside the property radius", () => {
    const decision = evaluateCommercialMissionLocationCheckIn({
      propertyLatitude: 34.1126,
      propertyLongitude: -118.287,
      latitude: 34.1133,
      longitude: -118.287,
      accuracyMeters: 20,
    });
    expect(decision.accepted).toBe(true);
    expect(decision.distanceMeters).toBeLessThan(
      COMMERCIAL_MISSION_LOCATION_CHECK_IN_RADIUS_METERS
    );
  });

  it("rejects a roughly 600-foot remote location check-in even with good GPS", () => {
    const decision = evaluateCommercialMissionLocationCheckIn({
      propertyLatitude: 34.1126,
      propertyLongitude: -118.287,
      latitude: 34.11425,
      longitude: -118.287,
      accuracyMeters: 10,
    });
    expect(decision).toMatchObject({
      accepted: false,
      reason: "outside_property_radius",
    });
    expect(decision.distanceMeters).toBeGreaterThan(180);
  });

  it("does not widen authoritative property radius for noisy GPS", () => {
    expect(
      evaluateCommercialMissionLocationCheckIn({
        propertyLatitude: 34.1126,
        propertyLongitude: -118.287,
        latitude: 34.1126,
        longitude: -118.287,
        accuracyMeters: 101,
      })
    ).toEqual({
      accepted: false,
      distanceMeters: null,
      reason: "poor_accuracy",
    });
  });

  it("keeps grounded lost reasons explicit", () => {
    expect(FIELD_OUTCOME_REASONS).toContain("pricing_objection");
    expect(FIELD_OUTCOME_REASONS).toContain("operational_incompatibility");
  });
});
