/**
 * The city's camera.
 *
 * Lantern City is a scene of real places drawn at real projected positions.
 * The camera moves the *view* over that scene and never the scene itself —
 * nothing in here writes a coordinate, so no amount of panning, zooming or
 * focusing can shift where a building actually is.
 *
 * Kept pure so the feel is testable: inertia, clamping, zoom-toward-cursor and
 * focus-and-return are all just arithmetic, and arithmetic can be asserted.
 */

export type Camera = {
  /** Viewport centre, in scene coordinates (0..1 of the scene's extent). */
  x: number;
  y: number;
  scale: number;
};

export type CameraLimits = {
  minScale: number;
  maxScale: number;
};

export const DEFAULT_CAMERA: Camera = { x: 0.5, y: 0.5, scale: 1 };
export const DEFAULT_LIMITS: CameraLimits = { minScale: 1, maxScale: 4 };

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

/**
 * Keeps the view over the scene.
 *
 * At scale 1 the whole scene fits, so the centre is pinned; zoomed in, the
 * centre may roam by exactly the margin the zoom created. This is what stops a
 * drag from flinging the city off into empty space.
 */
export function clampCamera(camera: Camera, limits = DEFAULT_LIMITS): Camera {
  const scale = clamp(camera.scale, limits.minScale, limits.maxScale);
  const margin = (1 - 1 / scale) / 2;
  return {
    scale,
    x: clamp(camera.x, 0.5 - margin, 0.5 + margin),
    y: clamp(camera.y, 0.5 - margin, 0.5 + margin),
  };
}

/**
 * Drags the scene under the pointer.
 *
 * Deltas arrive in viewport fractions; dividing by scale is what makes a drag
 * feel like it is moving the world rather than a map of it — the same finger
 * travel covers less ground the further in you are.
 */
export function panCamera(
  camera: Camera,
  deltaX: number,
  deltaY: number,
  limits = DEFAULT_LIMITS
): Camera {
  return clampCamera(
    { ...camera, x: camera.x - deltaX / camera.scale, y: camera.y - deltaY / camera.scale },
    limits
  );
}

/**
 * Zooms toward a point, keeping whatever is under it stationary.
 *
 * `focus` is in viewport fractions where 0.5,0.5 is the centre. Without this
 * correction a wheel zoom drifts away from what the player is looking at,
 * which is the single thing that makes a map feel broken to touch.
 */
export function zoomCameraToward(
  camera: Camera,
  factor: number,
  focus: { x: number; y: number },
  limits = DEFAULT_LIMITS
): Camera {
  const next = clamp(camera.scale * factor, limits.minScale, limits.maxScale);
  if (next === camera.scale) return camera;

  // Where the focus point sits in scene space before and after the zoom.
  const offsetX = (focus.x - 0.5) / camera.scale;
  const offsetY = (focus.y - 0.5) / camera.scale;
  const afterX = (focus.x - 0.5) / next;
  const afterY = (focus.y - 0.5) / next;

  return clampCamera(
    { scale: next, x: camera.x + offsetX - afterX, y: camera.y + offsetY - afterY },
    limits
  );
}

/** Frames one place. The scene does not move; the view arrives at it. */
export function focusCameraOn(
  target: { x: number; y: number },
  scale = 2.4,
  limits = DEFAULT_LIMITS
): Camera {
  return clampCamera({ x: target.x, y: target.y, scale }, limits);
}

/**
 * Eases the camera toward a goal. `amount` is the fraction of the remaining
 * distance to cover this frame, so movement decelerates naturally.
 */
export function approachCamera(camera: Camera, goal: Camera, amount: number): Camera {
  const t = clamp(amount, 0, 1);
  return {
    x: camera.x + (goal.x - camera.x) * t,
    y: camera.y + (goal.y - camera.y) * t,
    scale: camera.scale + (goal.scale - camera.scale) * t,
  };
}

export function camerasAreClose(a: Camera, b: Camera, epsilon = 0.0005): boolean {
  return (
    Math.abs(a.x - b.x) < epsilon &&
    Math.abs(a.y - b.y) < epsilon &&
    Math.abs(a.scale - b.scale) < epsilon
  );
}

export type Momentum = { x: number; y: number };

/** How quickly a flick dies. Tuned to stop rather than drift indefinitely. */
const FRICTION = 0.92;
const MOMENTUM_FLOOR = 0.00005;

/**
 * Carries a release into a glide, and stops.
 *
 * Returns null once the movement is spent, so the animation loop has a
 * definite end instead of running forever at imperceptible speeds.
 */
export function stepMomentum(momentum: Momentum): Momentum | null {
  const next = { x: momentum.x * FRICTION, y: momentum.y * FRICTION };
  if (Math.abs(next.x) < MOMENTUM_FLOOR && Math.abs(next.y) < MOMENTUM_FLOOR) return null;
  return next;
}

/** The scene transform for a camera, as a CSS transform string. */
export function cameraTransform(camera: Camera): string {
  // Rounded, because floating-point noise in a style string is both unreadable
  // and pointlessly precise for a value the compositor will quantise anyway.
  const round = (value: number) => Number(value.toFixed(4));
  const translateX = (0.5 - camera.x) * 100;
  const translateY = (0.5 - camera.y) * 100;
  return `scale(${round(camera.scale)}) translate(${round(translateX / camera.scale)}%, ${round(translateY / camera.scale)}%)`;
}

/** Distance between two touches, for pinch. */
export function touchDistance(
  a: { clientX: number; clientY: number },
  b: { clientX: number; clientY: number }
): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/** Midpoint of two touches, for pinch focus. */
export function touchCentroid(
  a: { clientX: number; clientY: number },
  b: { clientX: number; clientY: number }
): { clientX: number; clientY: number } {
  return {
    clientX: (a.clientX + b.clientX) / 2,
    clientY: (a.clientY + b.clientY) / 2,
  };
}
