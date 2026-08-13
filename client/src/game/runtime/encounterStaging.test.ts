import { describe, expect, it } from "vitest";
import { CameraController } from "./CameraController";

/** Minimal stand-in for the Pixi world container the camera moves. */
function fakeWorld() {
  return { x: 0, y: 0 } as { x: number; y: number };
}

/** Runs the camera forward far enough to have settled on its target. */
function settle(camera: CameraController, seconds = 1) {
  for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 60) {
    camera.update(1 / 60);
  }
}

describe("physical encounter staging keeps the player in the world", () => {
  it("lifts the world so the rail does not bury the avatar", () => {
    const world = fakeWorld();
    const camera = new CameraController(world as never);

    camera.stageEncounter(0);
    settle(camera);

    // Negative Y = world moved up, revealing more space above the bottom rail.
    expect(world.y).toBeLessThan(0);
  });

  it("keeps the lift restrained — framing, not a cutscene", () => {
    const world = fakeWorld();
    const camera = new CameraController(world as never);

    camera.stageEncounter(0);
    settle(camera);

    // A large displacement would read as teleporting to a different screen.
    expect(Math.abs(world.y)).toBeLessThanOrEqual(80);
  });

  it("biases toward the landmark's side of the corridor", () => {
    const left = fakeWorld();
    const right = fakeWorld();
    const leftCamera = new CameraController(left as never);
    const rightCamera = new CameraController(right as never);

    leftCamera.stageEncounter(-1);
    rightCamera.stageEncounter(1);
    settle(leftCamera);
    settle(rightCamera);

    // Opposite landmarks frame in opposite directions.
    expect(Math.sign(left.x)).toBe(-Math.sign(right.x));
    expect(left.x).not.toBe(0);
  });

  it("is fully reversible — exiting returns the same world view", () => {
    const world = fakeWorld();
    const camera = new CameraController(world as never);

    camera.stageEncounter(0.6);
    settle(camera);
    expect(camera.isStagingEncounter()).toBe(true);

    camera.clearEncounterStaging();
    // The ease is exponential, so it approaches zero asymptotically rather
    // than snapping — give it long enough to be visually settled.
    settle(camera, 2);

    expect(camera.isStagingEncounter()).toBe(false);
    expect(world.y).toBeCloseTo(0, 1);
    expect(world.x).toBeCloseTo(0, 1);
  });

  it("eases rather than snapping, so the world never jumps", () => {
    const world = fakeWorld();
    const camera = new CameraController(world as never);

    camera.stageEncounter(0);
    camera.update(1 / 60);
    const afterOneFrame = world.y;
    settle(camera);

    // One frame covers only part of the distance.
    expect(Math.abs(afterOneFrame)).toBeGreaterThan(0);
    expect(Math.abs(afterOneFrame)).toBeLessThan(Math.abs(world.y));
  });

  describe("reduced motion", () => {
    it("drops the lateral camera travel but still frames the encounter", () => {
      const world = fakeWorld();
      const camera = new CameraController(world as never);
      camera.setReducedMotion(true);

      camera.stageEncounter(-1);
      settle(camera);

      // No lateral travel…
      expect(world.x).toBeCloseTo(0, 1);
      // …but the encounter is still framed, so the rail does not cover the avatar.
      expect(world.y).toBeLessThan(0);
    });

    it("restores lateral framing when the preference is turned back off", () => {
      const world = fakeWorld();
      const camera = new CameraController(world as never);

      camera.setReducedMotion(true);
      camera.stageEncounter(-1);
      settle(camera);
      expect(world.x).toBeCloseTo(0, 1);

      camera.setReducedMotion(false);
      camera.stageEncounter(-1);
      settle(camera);
      expect(world.x).not.toBeCloseTo(0, 1);
    });
  });
});
