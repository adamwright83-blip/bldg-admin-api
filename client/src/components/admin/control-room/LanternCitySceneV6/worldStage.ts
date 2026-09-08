import type { Point } from "./sceneTypes";

/**
 * The authored world stage: a fixed 16:9 canvas that the base atlas, every
 * territory plate, and every scene object anchor are authored against, in
 * percent-of-stage coordinates (0-100). The viewport is rarely exactly
 * 16:9, so the atlas is shown with CSS `object-fit: cover` — uniformly
 * scaled up until it fills the viewport on both axes, then center-cropped
 * on whichever axis overflows. `worldStageTransform` computes the exact
 * same scale/offset a browser's `cover` algorithm would, so anything
 * placed with `worldPercentToScreen` lands on the pixel the artwork is
 * actually showing at that stage coordinate — never drifting off it.
 */
export const WORLD_STAGE = { width: 3840, height: 2160 } as const;

export type StageTransform = { scale: number; offsetX: number; offsetY: number };

export function worldStageTransform(viewport: {
  width: number;
  height: number;
}): StageTransform {
  const scale = Math.max(
    viewport.width / WORLD_STAGE.width,
    viewport.height / WORLD_STAGE.height
  );
  const renderedWidth = WORLD_STAGE.width * scale;
  const renderedHeight = WORLD_STAGE.height * scale;
  return {
    scale,
    offsetX: (viewport.width - renderedWidth) / 2,
    offsetY: (viewport.height - renderedHeight) / 2,
  };
}

/** A point expressed as a percentage (0-100) of the authored world stage -> screen pixels. */
export function worldPercentToScreen(
  point: Point,
  viewport: { width: number; height: number }
): Point {
  const t = worldStageTransform(viewport);
  return {
    x: t.offsetX + (point.x / 100) * WORLD_STAGE.width * t.scale,
    y: t.offsetY + (point.y / 100) * WORLD_STAGE.height * t.scale,
  };
}

/** A size expressed as a percentage of the authored world stage -> screen pixels. */
export function worldPercentSizeToScreen(
  size: { width: number; height: number },
  viewport: { width: number; height: number }
): { width: number; height: number } {
  const t = worldStageTransform(viewport);
  return {
    width: (size.width / 100) * WORLD_STAGE.width * t.scale,
    height: (size.height / 100) * WORLD_STAGE.height * t.scale,
  };
}
