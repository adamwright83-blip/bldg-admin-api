import { describe, expect, it } from "vitest";
import {
  DEFAULT_FIELD_CHECKLIST,
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

  it("keeps grounded lost reasons explicit", () => {
    expect(FIELD_OUTCOME_REASONS).toContain("pricing_objection");
    expect(FIELD_OUTCOME_REASONS).toContain("operational_incompatibility");
  });
});
