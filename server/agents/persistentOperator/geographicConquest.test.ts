/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { describe, expect, it } from "vitest";
import { propagateGeographicConquest } from "./geographicConquestService";

describe("GeographicConquestPropagation", () => {
  it("fails gracefully when accountId and missionId cannot be resolved", async () => {
    const result = await propagateGeographicConquest({
      tenantId: "t-geo-test-nonexistent",
    });
    expect(result.propagated).toBe(false);
    expect(
      result.reason === "Database unavailable" ||
        result.reason?.includes("Could not resolve commercial account ID")
    ).toBe(true);
  });

  it("exports propagateGeographicConquest function with expected contract", () => {
    expect(typeof propagateGeographicConquest).toBe("function");
  });
});
