import { describe, expect, it } from "vitest";
import {
  DEMO_MISSION,
  assertMissionSurfaceContinuity,
  formatCurrencyFromCents,
  formatMissionCode,
  toCommercialMissionSurface,
} from "./commercialMission";

describe("commercial mission contract", () => {
  it("formats durable public mission codes", () => {
    expect(formatMissionCode(42)).toBe("MISSION 042");
    expect(formatMissionCode(1004)).toBe("MISSION 1004");
  });

  it("formats annual values from cents", () => {
    expect(formatCurrencyFromCents(2_480_000)).toBe("$24,800");
  });

  it("accepts identical mission snapshots across product surfaces", () => {
    const surface = toCommercialMissionSurface(DEMO_MISSION);
    expect(() =>
      assertMissionSurfaceContinuity(DEMO_MISSION, [
        surface,
        { ...surface },
        { ...surface },
      ])
    ).not.toThrow();
  });

  it("rejects a device surface that silently renames the account", () => {
    const surface = toCommercialMissionSurface(DEMO_MISSION);
    expect(() =>
      assertMissionSurfaceContinuity(DEMO_MISSION, [
        surface,
        { ...surface, accountName: "Westview Property Mgmt" },
      ])
    ).toThrow(/continuity failed/i);
  });
});
