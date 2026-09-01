import { describe, expect, it } from "vitest";
import {
  approachCamera,
  cameraTransform,
  camerasAreClose,
  clampCamera,
  DEFAULT_CAMERA,
  focusCameraOn,
  panCamera,
  stepMomentum,
  touchCentroid,
  touchDistance,
  zoomCameraToward,
} from "./goldlineCamera";

describe("the camera moves the view, never the city", () => {
  it("pins the centre when the whole scene already fits", () => {
    const panned = panCamera(DEFAULT_CAMERA, 0.4, 0.4);
    expect(panned.x).toBe(0.5);
    expect(panned.y).toBe(0.5);
  });

  it("lets the view roam exactly as far as the zoom allows", () => {
    const zoomed = { x: 0.5, y: 0.5, scale: 2 };
    const panned = panCamera(zoomed, -1, -1);
    // At 2x the margin is a quarter of the scene in each direction.
    expect(panned.x).toBeCloseTo(0.75, 5);
    expect(panned.y).toBeCloseTo(0.75, 5);
  });

  it("makes a drag cover less ground the further in you are", () => {
    const near = panCamera({ x: 0.5, y: 0.5, scale: 2 }, 0.1, 0);
    const far = panCamera({ x: 0.5, y: 0.5, scale: 4 }, 0.1, 0);
    expect(0.5 - near.x).toBeGreaterThan(0.5 - far.x);
  });

  it("refuses to zoom past its limits", () => {
    expect(zoomCameraToward(DEFAULT_CAMERA, 0.1, { x: 0.5, y: 0.5 }).scale).toBe(1);
    expect(
      zoomCameraToward({ x: 0.5, y: 0.5, scale: 4 }, 10, { x: 0.5, y: 0.5 }).scale
    ).toBe(4);
  });

  it("keeps what is under the cursor under the cursor", () => {
    /*
      The thing that makes a map feel broken is zooming away from what you are
      looking at. Zooming toward a corner then back must return you home.
      */
    const focus = { x: 0.8, y: 0.3 };
    const zoomedIn = zoomCameraToward(DEFAULT_CAMERA, 2, focus);
    const backOut = zoomCameraToward(zoomedIn, 0.5, focus);
    expect(camerasAreClose(backOut, DEFAULT_CAMERA, 0.002)).toBe(true);
  });

  it("moves toward the side the cursor is on", () => {
    const zoomed = zoomCameraToward(DEFAULT_CAMERA, 2, { x: 0.9, y: 0.5 });
    expect(zoomed.x).toBeGreaterThan(0.5);
  });

  it("frames a place without moving it", () => {
    const target = { x: 0.31, y: 0.62 };
    const framed = focusCameraOn(target);
    expect(framed.scale).toBeGreaterThan(1);
    // The target itself is untouched by being looked at.
    expect(target).toEqual({ x: 0.31, y: 0.62 });
  });

  it("clamps a focus near the edge back into the scene", () => {
    const framed = focusCameraOn({ x: 0.98, y: 0.02 }, 2);
    expect(framed.x).toBeLessThanOrEqual(0.75);
    expect(framed.y).toBeGreaterThanOrEqual(0.25);
  });
});

describe("movement that settles instead of snapping", () => {
  it("eases toward a goal and gets there", () => {
    const goal = { x: 0.7, y: 0.3, scale: 2 };
    let camera = DEFAULT_CAMERA;
    for (let frame = 0; frame < 120; frame += 1) camera = approachCamera(camera, goal, 0.18);
    expect(camerasAreClose(camera, goal)).toBe(true);
  });

  it("decelerates rather than moving linearly", () => {
    const goal = { x: 1, y: 0.5, scale: 1 };
    const first = approachCamera(DEFAULT_CAMERA, goal, 0.2);
    const second = approachCamera(first, goal, 0.2);
    expect(second.x - first.x).toBeLessThan(first.x - DEFAULT_CAMERA.x);
  });

  it("brings a flick to a definite stop", () => {
    // A glide that never ends is an animation loop that never ends.
    let momentum: { x: number; y: number } | null = { x: 0.02, y: -0.015 };
    let frames = 0;
    while (momentum && frames < 1000) {
      momentum = stepMomentum(momentum);
      frames += 1;
    }
    expect(momentum).toBeNull();
    expect(frames).toBeLessThan(200);
  });
});

describe("the transform handed to the scene", () => {
  it("is identity-ish at rest", () => {
    expect(cameraTransform(DEFAULT_CAMERA)).toContain("scale(1)");
    expect(cameraTransform(DEFAULT_CAMERA)).toContain("translate(0%, 0%)");
  });

  it("translates opposite the camera, so the world moves under the view", () => {
    const transform = cameraTransform({ x: 0.6, y: 0.5, scale: 1 });
    expect(transform).toContain("translate(-10%");
  });
});

describe("pinch arithmetic", () => {
  it("measures the gap between two touches", () => {
    expect(
      touchDistance({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 })
    ).toBe(5);
  });

  it("finds the point between them to zoom toward", () => {
    expect(
      touchCentroid({ clientX: 0, clientY: 10 }, { clientX: 10, clientY: 30 })
    ).toEqual({ clientX: 5, clientY: 20 });
  });
});
