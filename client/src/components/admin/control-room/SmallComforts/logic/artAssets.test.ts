import { describe, expect, it } from "vitest";
import { SMALL_COMFORTS_ART } from "./artAssets";

describe("Small Comforts runtime art manifest", () => {
  it("uses the validated suitcase v3 contract", () => {
    expect(SMALL_COMFORTS_ART.suitcase.url).toContain("sc_suitcase_v3.glb");
    expect(SMALL_COMFORTS_ART.suitcase.openAngleDeg).toBe(107);
    expect(SMALL_COMFORTS_ART.suitcase.hinge).toEqual([0, 0.9333333373069763, -2.4666666984558105]);
    expect(SMALL_COMFORTS_ART.suitcase.expectedNodes).toContain("Suitcase_Lid");
    expect(SMALL_COMFORTS_ART.suitcase.expectedNodes).toContain("Brass_Latch");
  });

  it("uses the validated v2 bed and lamp", () => {
    expect(SMALL_COMFORTS_ART.bed.url).toContain("sc_bed_v2.glb");
    expect(SMALL_COMFORTS_ART.lamp.url).toContain("sc_lamp_v2.glb");
  });
});
