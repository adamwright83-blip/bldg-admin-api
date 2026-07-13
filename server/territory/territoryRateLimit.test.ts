import { describe, expect, it } from "vitest";
import { assertTerritoryPreviewRateLimit, resetTerritoryRateLimitsForTests } from "./territoryRateLimit";

describe("territory preview rate limit", () => {
  it("limits anonymous scans per hour", () => {
    resetTerritoryRateLimitsForTests();
    for (let count = 0; count < 5; count += 1) assertTerritoryPreviewRateLimit("ip", 1000);
    expect(() => assertTerritoryPreviewRateLimit("ip", 1000)).toThrow(/rate limit/);
    expect(() => assertTerritoryPreviewRateLimit("ip", 3_700_001)).not.toThrow();
  });
});
