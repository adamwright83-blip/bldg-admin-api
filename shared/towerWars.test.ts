import { describe, expect, it } from "vitest";
import { canUsePromiseForDirectOutreach } from "./towerWars";

describe("Tower Wars resident permission gate", () => {
  it("requires recorded permission on a direct channel", () => {
    expect(canUsePromiseForDirectOutreach({ permissionStatus: "recorded", permissionChannel: "sms" })).toBe(true);
    expect(canUsePromiseForDirectOutreach({ permissionStatus: "not_recorded", permissionChannel: "sms" })).toBe(false);
    expect(canUsePromiseForDirectOutreach({ permissionStatus: "recorded", permissionChannel: "physical_delivery" })).toBe(false);
  });
});
