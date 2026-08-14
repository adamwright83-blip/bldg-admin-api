import { describe, expect, it } from "vitest";
import type { CorridorMissionAnchorPoint } from "../../../../shared/corridorManifest";
import {
  ambientPresentation,
  bindMissionToPopulation,
  bindOrderToPopulation,
  isMissionApproachable,
  isOrderApproachable,
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

const authoritativeOrder = {
  orderId: 501,
  orderKey: "order:501",
  kind: "pickup" as const,
  label: "Fixture Customer",
};

describe("order (pickup/delivery) world-objective boundary", () => {
  it("creates no embodiment without a real positive order id", () => {
    expect(bindOrderToPopulation(null, anchors)).toBeNull();
    expect(
      bindOrderToPopulation({ ...authoritativeOrder, orderId: 0 }, anchors)
    ).toBeNull();
  });

  it("binds the same order to the same authored slot deterministically", () => {
    const first = bindOrderToPopulation(authoritativeOrder, anchors);
    const second = bindOrderToPopulation(authoritativeOrder, [...anchors]);
    expect(first?.anchorId).toBe(second?.anchorId);
    expect(first).not.toHaveProperty("address");
    expect(first).not.toHaveProperty("customerName");
  });

  it("avoids the active mission's anchor when more than one slot exists", () => {
    const missionEmbodiment = bindMissionToPopulation(
      authoritativeMission,
      anchors
    );
    const orderEmbodiment = bindOrderToPopulation(
      authoritativeOrder,
      anchors,
      missionEmbodiment?.anchorId ?? null
    );
    // Only two anchors are authored in this fixture; a genuine collision
    // must shift to the other one rather than overlapping visually.
    if (missionEmbodiment && orderEmbodiment) {
      expect(orderEmbodiment.anchorId).not.toBe(missionEmbodiment.anchorId);
    }
  });

  it("requires genuine physical proximity to the order's authored slot", () => {
    const embodiment = bindOrderToPopulation(authoritativeOrder, anchors);
    expect(embodiment).not.toBeNull();
    expect(
      isOrderApproachable(
        embodiment,
        embodiment!.anchor.position.progress,
        embodiment!.anchor.position.lateral
      )
    ).toBe(true);
    expect(isOrderApproachable(embodiment, 0.05, 0.7)).toBe(false);
  });

  it("removes the world objective when the real order resolves/disappears", () => {
    expect(bindOrderToPopulation(authoritativeOrder, anchors)).not.toBeNull();
    expect(bindOrderToPopulation(null, anchors)).toBeNull();
  });
});
