import { describe, expect, it } from "vitest";
import { campaignRunOwnerIsAuthorized } from "./campaignRunService";

describe("Campaign Run canonical ownership", () => {
  it("keeps an alias-owned historical run writable by the same canonical operator", () => {
    expect(
      campaignRunOwnerIsAuthorized({
        runOperatorUserId: "driver-primary",
        operatorUserId: "admin-owner",
        authorizedOperatorUserIds: ["admin-owner", "driver-primary"],
      })
    ).toBe(true);
  });

  it("does not authorize an unrelated operator merely because aliases exist", () => {
    expect(
      campaignRunOwnerIsAuthorized({
        runOperatorUserId: "other-driver",
        operatorUserId: "admin-owner",
        authorizedOperatorUserIds: ["admin-owner", "driver-primary"],
      })
    ).toBe(false);
  });

  it("preserves exact-owner behavior when no canonical aliases are supplied", () => {
    expect(
      campaignRunOwnerIsAuthorized({
        runOperatorUserId: "driver-primary",
        operatorUserId: "driver-primary",
      })
    ).toBe(true);
    expect(
      campaignRunOwnerIsAuthorized({
        runOperatorUserId: "driver-primary",
        operatorUserId: "admin-owner",
      })
    ).toBe(false);
  });
});
