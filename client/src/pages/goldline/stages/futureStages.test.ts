import { describe, expect, it } from "vitest";
import { isWalkable } from "../overworld/navigation";
import { CRYSTAL_CHASM_STAGE, FUTURE_GOLDLINE_STAGES, WAYWARD_APPROACH_STAGE } from "./futureStages";
import { depthScale, depthSpeedFactor } from "./stageDefinition";

describe("future Goldline stage contracts reuse production world geometry", () => {
  it.each(FUTURE_GOLDLINE_STAGES)("keeps $map.id larger than a portrait viewport", stage => {
    expect(stage.map.width).toBeGreaterThan(stage.map.height);
    expect(stage.map.surfaces.length + stage.map.corridors.length).toBeGreaterThan(1);
    expect(stage.presentation.liveEntityIds).toContain("trailblazer");
  });

  it("authors the Wayward deck instead of allowing rectangular free-roam", () => {
    const map = WAYWARD_APPROACH_STAGE.map;
    expect(isWalkable(map, map.spawns[map.defaultSpawnId]!, 11)).toBe(true);
    expect(isWalkable(map, { x: 20, y: 300 }, 11)).toBe(false);
    expect(isWalkable(map, { x: 1500, y: 600 }, 11)).toBe(false);
    expect(map.traversals.find(item => item.id === "linehook-pull")).toBeTruthy();
  });

  it("reduces scale and speed toward the far stage", () => {
    for (const stage of FUTURE_GOLDLINE_STAGES) {
      expect(depthScale(stage.presentation, stage.presentation.depth.nearY)).toBeCloseTo(stage.presentation.depth.nearScale);
      expect(depthScale(stage.presentation, stage.presentation.depth.farY)).toBeCloseTo(stage.presentation.depth.farScale);
      expect(depthSpeedFactor(stage.presentation, stage.presentation.depth.farY)).toBeCloseTo(stage.presentation.depth.farSpeedFactor);
    }
  });

  it("keeps stateful figures out of permanent background art", () => {
    expect(WAYWARD_APPROACH_STAGE.presentation.liveEntityIds).toContain("tether-guardian");
    expect(CRYSTAL_CHASM_STAGE.presentation.liveEntityIds).toContain("prism-regent");
  });
});
