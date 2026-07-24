import { describe, expect, it } from "vitest";
import { legacyRoleCanOwnCommercialCampaignSalespersonScope } from "./commercialCampaignLinkStore";

describe("commercial campaign link legacy salesperson ownership", () => {
  it("accepts legacy driver assignees", () => {
    expect(legacyRoleCanOwnCommercialCampaignSalespersonScope("driver")).toBe(
      true
    );
  });

  it("keeps legacy admins eligible and excludes resident users", () => {
    expect(legacyRoleCanOwnCommercialCampaignSalespersonScope("admin")).toBe(
      true
    );
    expect(legacyRoleCanOwnCommercialCampaignSalespersonScope("user")).toBe(
      false
    );
  });
});
