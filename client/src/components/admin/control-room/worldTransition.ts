/**
 * THE WORLD TRANSITION COORDINATOR
 *
 * Goldline's surfaces describe one world at different camera distances, but moving
 * between them was ordinary React route replacement: Home, Lantern City and Tower
 * Wars are eager imports, so a click unmounted one DOM tree and mounted another in a
 * single paint. Nothing carried the identity of the building you clicked — both Home
 * towers navigated to the same path with no payload — so the destination could not
 * know which building you had chosen.
 *
 * This module is the grammar for spatial traversal. A transition is not an animation
 * preset; it is a claim that the SAME canonical entity is being approached from a
 * different distance, and it carries everything needed to make that legible.
 *
 * THE ONE-SECOND LAW
 *
 * DESIGN-LAWS #6 requires visible consequences within one second. A cinematic that
 * delays the truth violates it. So: STATE COMMITS FIRST, CAMERA FOLLOWS. The route
 * changes and the destination renders its real state immediately; the camera move is
 * a presentation layer over the top, and it is always interruptible. No transition
 * may gate a business fact behind an animation.
 */

import type { CanonicalBuildingId } from "./buildingArt";

export type WorldCamera = "city" | "building" | "interior";

/** Why we are moving. Only `traversal` earns a camera journey. */
export type TransitionKind =
  /** The user selected a specific entity and is moving toward it. */
  | "traversal"
  /** Arrived cold (deep link, refresh). There is no journey to depict. */
  | "establishing"
  /** Returning outward along a journey that actually happened. */
  | "reverse";

export type WorldRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type WorldTransition = {
  /** The canonical entity being approached. Never a route, always a thing. */
  entityId: string;
  kind: TransitionKind;
  from: WorldCamera;
  to: WorldCamera;
  /** Measured at runtime — mobile arena geometry differs from desktop. */
  sourceRect: WorldRect | null;
  /** Where the user came from, so a reverse lands where they actually were. */
  returnPath: string | null;
  /** The authoritative event that motivated this move, when there is one. */
  causalEventId: string | null;
  reducedMotion: boolean;
  startedAt: number;
};

export const CANONICAL_GEOGRAPHIC_TARGETS = {
  opus_la: { latitude: 34.0618, longitude: -118.3011, altitude: 700, range: 1400, heading: 195, tilt: 55 },
  century_park_east: { latitude: 34.0591, longitude: -118.4147, altitude: 700, range: 1400, heading: 140, tilt: 55 },
} as const;

export const TRAVERSAL_MS = 900;
export const ESTABLISHING_MS = 420;
/** Reduced motion keeps identity and causality, and drops the vestibular movement. */
export const REDUCED_MS = 160;

export function transitionDuration(t: Pick<WorldTransition, "kind" | "reducedMotion">): number {
  if (t.reducedMotion) return REDUCED_MS;
  return t.kind === "traversal" || t.kind === "reverse"
    ? TRAVERSAL_MS
    : ESTABLISHING_MS;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function measureRect(el: Element | null): WorldRect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/**
 * Decide what kind of move this is.
 *
 * A reverse may only be played when a journey actually happened — never
 * reverse-animate from a place the user was never at.
 */
export function classifyArrival(input: {
  hasSourceRect: boolean;
  cameFromWorld: boolean;
  isBack: boolean;
}): TransitionKind {
  if (input.isBack && input.cameFromWorld) return "reverse";
  if (input.hasSourceRect && input.cameFromWorld) return "traversal";
  return "establishing";
}

/** Read the canonical entity a destination was entered for, if any. */
export function entityFromSearch(search: string): CanonicalBuildingId | null {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const building = q.get("building");
  return building === "opus_la" || building === "century_park_east"
    ? building
    : null;
}

/**
 * FLIP geometry: the transform that would place the destination element exactly
 * where the source element was, so the entity appears not to move at handover.
 */
export function flipTransform(source: WorldRect, destination: WorldRect): string {
  const sx = source.width / destination.width;
  const sy = source.height / destination.height;
  const dx = source.left - destination.left;
  const dy = source.top - destination.top;
  return `translate(${dx}px, ${dy}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
}
