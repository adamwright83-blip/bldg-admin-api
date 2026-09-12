/**
 * THE GROUND PLANE — the thing whose absence made every actor read as a sticker.
 *
 * The rooms are painted in perspective: the terrace is narrow at the back and
 * wide at the front. The actors were not. Every character rendered at a fixed
 * pixel size wherever it stood, with a fixed-size shadow, inside a rectangular
 * play box. Three symptoms, one cause — nothing in the chapter knew the floor
 * was a receding surface.
 *
 * Research ranking for integrating sprites into painted perspective backgrounds
 * puts ground-plane projection with depth scaling at roughly 40% of the effect
 * and dual-layer contact shadows at a further 30%. This module is those two.
 *
 * `ExpeditionLayer` already had a projection returning {x, y, scale}. The
 * chapter never got one. This is the chapter's.
 */

/** Per-room perspective, authored against the painted background. */
export type GroundPlane = {
  /** Screen y of the FAR edge of the walkable floor. Depth 0. */
  readonly yFar: number;
  /** Screen y of the NEAR edge of the walkable floor. Depth 1. */
  readonly yNear: number;
  /** Sprite scale at the far edge, relative to 1.0 at the near edge. */
  readonly scaleFar: number;
  /** Curvature of the falloff. Linear (1.0) reads mechanical; 0.8-1.4 is the band. */
  readonly exponent: number;
  /** Half-width of the walkable floor at the far edge, in px from centre. */
  readonly halfWidthFar: number;
  /** Half-width at the near edge. Wider, because the floor opens toward camera. */
  readonly halfWidthNear: number;
  /** Screen x the floor recedes toward. */
  readonly centreX: number;
};

/**
 * scaleFar sits at 0.60 rather than the 0.25-0.50 the reference gives for deep
 * corridors. These rooms are shallow terraces, not corridors — the far edge is
 * a balustrade a few metres back, not a vanishing point. Pushing to 0.35 here
 * made the heroine read as a child at the back wall.
 */
export const GROUND_PLANES: Record<string, GroundPlane> = {
  arrival: { yFar: 116, yNear: 534, scaleFar: 0.60, exponent: 1.15, halfWidthFar: 250, halfWidthNear: 404, centreX: 480 },
  garden:  { yFar: 116, yNear: 534, scaleFar: 0.62, exponent: 1.15, halfWidthFar: 268, halfWidthNear: 404, centreX: 480 },
  gallery: { yFar: 116, yNear: 534, scaleFar: 0.64, exponent: 1.10, halfWidthFar: 286, halfWidthNear: 404, centreX: 480 },
};

/** 0 at the far edge of the floor, 1 at the near edge. */
export function depthAt(plane: GroundPlane, y: number): number {
  const t = (y - plane.yFar) / (plane.yNear - plane.yFar);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Sprite scale for a foot position. Feet anchored, so this scales about the ground. */
export function scaleAt(plane: GroundPlane, y: number): number {
  const t = depthAt(plane, y);
  return plane.scaleFar + (1 - plane.scaleFar) * Math.pow(t, plane.exponent);
}

/**
 * Half-width of walkable floor at a given depth.
 *
 * The play area used to be a rectangle laid over a floor painted in
 * perspective, so near the back the heroine walked straight through the
 * balustrade and stood on open air above the city. The floor is a trapezoid;
 * the boundary has to be one too.
 */
export function halfWidthAt(plane: GroundPlane, y: number): number {
  const t = depthAt(plane, y);
  return plane.halfWidthFar + (plane.halfWidthNear - plane.halfWidthFar) * t;
}

/** Clamp a point to the painted floor. Returns the clamped x. */
export function clampToFloorX(plane: GroundPlane, x: number, y: number): number {
  const half = halfWidthAt(plane, y);
  const lo = plane.centreX - half;
  const hi = plane.centreX + half;
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Dual-layer contact shadow geometry for a foot position.
 *
 * A single mid-grey ellipse is the classic sticker tell: real contact shadow
 * has a dark, tight core where the object meets the floor and a wide, faint
 * ambient wash around it. Both must shrink and fade with depth, or the shadow
 * betrays the compositing even when the sprite scale is right.
 */
export function shadowAt(plane: GroundPlane, y: number, footHalfWidth: number) {
  const s = scaleAt(plane, y);
  return {
    core:    { rx: footHalfWidth * 0.90 * s, ry: footHalfWidth * 0.30 * s, alpha: 0.34 + 0.30 * s, dy: 2 * s },
    ambient: { rx: footHalfWidth * 1.85 * s, ry: footHalfWidth * 0.62 * s, alpha: 0.07 + 0.13 * s, dy: 4 * s },
  };
}
