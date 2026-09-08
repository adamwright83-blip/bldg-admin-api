import { describe, it, expect } from "vitest";
import { BUILDING_ART, RETIRED_BUILDING_ART } from "./buildingArt";

describe("canonical stronghold weapon art", () => {
  it("OPUS LA carries the giant architectural golf driver overlay", () => {
    expect(BUILDING_ART.opus_la.weapon).toContain("opus-la-driver-overlay");
  });
  it("Century Park East carries the rooftop bazooka overlay", () => {
    expect(BUILDING_ART.century_park_east.weapon).toContain(
      "century-bazooka-overlay"
    );
  });
  it("neither stronghold's plate or weapon is a retired asset", () => {
    for (const building of Object.values(BUILDING_ART)) {
      for (const retired of RETIRED_BUILDING_ART) {
        expect(building.plate).not.toContain(retired);
        expect(building.weapon).not.toContain(retired);
      }
    }
  });
});
