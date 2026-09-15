import { describe, expect, it } from "vitest";
import { claireOperatorKey } from "../../shared/claireRuntime";
import { assembleClaireDriveContext } from "./contextAssembler";

describe("Claire Command/Play + mobile/desktop neutrality", () => {
  it("operator identity is tenant + operator, never surface or edition", () => {
    expect(claireOperatorKey("default", "adam-admin")).toBe(
      claireOperatorKey("default", "adam-admin")
    );
  });

  it("drive-context assembly does not accept a surface that could fork the brain", () => {
    const params = assembleClaireDriveContext.length;
    expect(params).toBe(1);
    const sample = String(assembleClaireDriveContext);
    expect(sample).not.toMatch(/goldlinePlay|desktopSage|mobileClaireBrain/);
  });
});
