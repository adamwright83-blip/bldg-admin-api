import { describe, it, expect } from "vitest";
import {
  WORLD_STAGE,
  worldStageTransform,
  worldPercentToScreen,
  worldPercentSizeToScreen,
} from "./worldStage";

describe("world stage transform", () => {
  it("matches CSS object-fit: cover exactly at a non-16:9 viewport", () => {
    // Reproduces the drift example: 1440x900 is not 16:9, so a 3840x2160
    // atlas shown with `cover` renders at 1600x900 and loses 80px off each
    // side. A world point at 25% X must resolve to 320px, not 360px.
    const viewport = { width: 1440, height: 900 };
    const t = worldStageTransform(viewport);
    expect(t.scale).toBeCloseTo(900 / 2160, 10);
    expect(t.offsetX).toBeCloseTo(-80, 6);
    expect(t.offsetY).toBeCloseTo(0, 6);
    const screen = worldPercentToScreen({ x: 25, y: 50 }, viewport);
    expect(screen.x).toBeCloseTo(320, 6);
    expect(screen.y).toBeCloseTo(450, 6);
  });
  it("matches CSS object-fit: cover exactly at 1280x900", () => {
    const viewport = { width: 1280, height: 900 };
    const screen = worldPercentToScreen({ x: 25, y: 50 }, viewport);
    // scale = max(1280/3840, 900/2160) = 900/2160; rendered width = 1600;
    // offsetX = (1280-1600)/2 = -160; screenX = -160 + 0.25*1600 = 240.
    expect(screen.x).toBeCloseTo(240, 6);
  });
  it("has no crop on either axis when the viewport is exactly 16:9", () => {
    const viewport = { width: 1920, height: 1080 };
    const t = worldStageTransform(viewport);
    expect(t.offsetX).toBeCloseTo(0, 6);
    expect(t.offsetY).toBeCloseTo(0, 6);
    const center = worldPercentToScreen({ x: 50, y: 50 }, viewport);
    expect(center.x).toBeCloseTo(960, 6);
    expect(center.y).toBeCloseTo(540, 6);
  });
  it("scales a world-percent size by the same factor as a world-percent point", () => {
    const viewport = { width: 1440, height: 900 };
    const t = worldStageTransform(viewport);
    const size = worldPercentSizeToScreen({ width: 10, height: 10 }, viewport);
    expect(size.width).toBeCloseTo((10 / 100) * WORLD_STAGE.width * t.scale, 6);
    expect(size.height).toBeCloseTo(
      (10 / 100) * WORLD_STAGE.height * t.scale,
      6
    );
  });
  it("a known authored world point resolves to the same screen coordinate at every target viewport's own crop", () => {
    // The point itself is fixed in world-stage space; only the pixel it
    // lands on (via that viewport's own scale/offset) should change.
    const point = { x: 47, y: 49 }; // koreatown's authored anchor
    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 1440, height: 900 },
      { width: 1280, height: 900 },
    ]) {
      const t = worldStageTransform(viewport);
      const expected = {
        x: t.offsetX + (point.x / 100) * WORLD_STAGE.width * t.scale,
        y: t.offsetY + (point.y / 100) * WORLD_STAGE.height * t.scale,
      };
      expect(worldPercentToScreen(point, viewport)).toEqual(expected);
    }
  });
});
