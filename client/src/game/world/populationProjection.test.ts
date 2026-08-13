import { describe, expect, it } from "vitest";
import type { CorridorMissionAnchorPoint } from "../../../../shared/corridorManifest";
import {
  ambientPresentation,
  bindMissionToPopulation,
  isMissionApproachable,
} from "./populationProjection";

const anchors: CorridorMissionAnchorPoint[] = [
  {
    id: "slot-a",
    position: { progress: 0.4, lateral: 0.1 },
    facing: "forward",
    stagingRadius: 0.08,
    capacity: 1,
    cameraBias: 0,
    cameraLift: 0.12,
    nearbyAmbientCompatibility: ["walk"],
  },
  {
    id: "slot-b",
    position: { progress: 0.6, lateral: -0.1 },
    facing: "left",
    stagingRadius: 0.08,
    capacity: 1,
    cameraBias: -0.1,
    cameraLift: 0.14,
    nearbyAmbientCompatibility: ["phone"],
  },
];

const authoritativeMission = {
  missionId: 91,
  missionKey: "mission:91",
  archetype: "GATEKEEPER" as const,
  state: "available" as const,
  affordance: "CALL" as const,
  worldSignal: "actionable" as const,
};

describe("population truth boundary", () => {
  it("never gives ambient people a mission or action affordance", () => {
    expect(
      ambientPresentation([
        {
          id: "ambient-a",
          spriteId: "role-a",
          position: { progress: 0.2, lateral: 0 },
          depthLayer: "L2",
          facing: "forward",
          behavior: "phone",
          path: [],
          visibilityRadius: 0.4,
          occlusionRule: "world",
        },
      ])
    ).toEqual([
      {
        id: "ambient-a",
        behavior: "phone",
        actionable: false,
        missionId: null,
      },
    ]);
  });

  it("creates no embodiment without an authoritative positive mission id", () => {
    expect(bindMissionToPopulation(null, anchors)).toBeNull();
    expect(
      bindMissionToPopulation(
        { ...authoritativeMission, missionId: 0 },
        anchors
      )
    ).toBeNull();
  });

  it("binds the same mission to the same authored slot deterministically", () => {
    const first = bindMissionToPopulation(authoritativeMission, anchors);
    const second = bindMissionToPopulation(authoritativeMission, [...anchors]);
    expect(first?.anchorId).toBe(second?.anchorId);
    expect(first?.representation).toBe("generic_role_figure");
    expect(first).not.toHaveProperty("contactName");
    expect(first).not.toHaveProperty("contactId");
    expect(first).not.toHaveProperty("gender");
    expect(first).not.toHaveProperty("face");
  });

  it("removes the embodiment when authoritative projection removes the mission", () => {
    expect(
      bindMissionToPopulation(authoritativeMission, anchors)
    ).not.toBeNull();
    expect(bindMissionToPopulation(null, anchors)).toBeNull();
  });

  it("stages Ghost as an absence scene instead of inventing a person", () => {
    const ghost = bindMissionToPopulation(
      { ...authoritativeMission, archetype: "GHOST" },
      anchors
    );
    expect(ghost?.representation).toBe("absence_scene");
  });

  it("requires physical proximity to the authoritative mission slot", () => {
    const embodiment = bindMissionToPopulation(authoritativeMission, anchors);
    expect(embodiment).not.toBeNull();
    expect(
      isMissionApproachable(
        embodiment,
        embodiment!.anchor.position.progress,
        embodiment!.anchor.position.lateral
      )
    ).toBe(true);
    expect(isMissionApproachable(embodiment, 0.05, 0.7)).toBe(false);
  });
});
