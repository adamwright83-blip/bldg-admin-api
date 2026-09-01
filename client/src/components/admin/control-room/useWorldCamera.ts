/**
 * Makes the city physical to touch.
 *
 * The camera moves one world container. Every real place stays exactly where
 * its projected coordinate put it — they are children of the thing being
 * transformed, so the whole scene moves together and no building's position is
 * ever rewritten to suit the view.
 *
 * Fixed interface — Field Ops, the briefing, HUD — deliberately lives outside
 * that container, so a pan never drags the controls and an explosion never
 * shakes them.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  approachCamera,
  camerasAreClose,
  cameraTransform,
  clampCamera,
  DEFAULT_CAMERA,
  focusCameraOn,
  panCamera,
  stepMomentum,
  touchCentroid,
  touchDistance,
  zoomCameraToward,
  type Camera,
  type Momentum,
} from "@shared/goldlineCamera";

/** Below this, a pointer press is a click on a building, not a drag of the city. */
const DRAG_THRESHOLD_PX = 4;

export type WorldCamera = {
  camera: Camera;
  transform: string;
  isDragging: boolean;
  /** Move the view to a place, remembering where it came from. */
  focusOn: (target: { x: number; y: number }, scale?: number) => void;
  /** Return to wherever the view was before the last focus. */
  restore: () => void;
  reset: () => void;
  zoomBy: (factor: number) => void;
  /** Attach to the element that contains the world container. */
  bind: {
    ref: (node: HTMLElement | null) => void;
  };
};

export function useWorldCamera(options?: { disabled?: boolean }): WorldCamera {
  const disabled = options?.disabled ?? false;
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const [isDragging, setIsDragging] = useState(false);

  const hostRef = useRef<HTMLElement | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  /** Where the view was before a focus, so closing an inspector can return. */
  const previousRef = useRef<Camera | null>(null);
  const goalRef = useRef<Camera | null>(null);
  const momentumRef = useRef<Momentum | null>(null);
  const frameRef = useRef<number | null>(null);
  const pointerRef = useRef<{
    id: number;
    lastX: number;
    lastY: number;
    movedPx: number;
  } | null>(null);
  const pinchRef = useRef<{ distance: number } | null>(null);
  /*
    Dragging is tracked in a ref as well as state. The listener effect must not
    depend on the state, or the first move tears the listeners down and re-arms
    them mid-gesture — which silently drops the rest of the drag and the glide.
  */
  const draggingRef = useRef(false);
  const touchesRef = useRef(new Map<number, { clientX: number; clientY: number }>());
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionRef.current = query.matches;
    const listener = (event: MediaQueryListEvent) => {
      reducedMotionRef.current = event.matches;
    };
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  /**
   * One animation loop for easing and glide, which stops itself the moment
   * there is nothing left to do rather than idling forever.
   */
  const ensureLoop = useCallback(() => {
    if (frameRef.current !== null) return;
    const step = () => {
      frameRef.current = null;
      let active = false;

      const goal = goalRef.current;
      if (goal) {
        const current = cameraRef.current;
        // Reduced motion still arrives, it simply does not travel.
        const next = reducedMotionRef.current ? goal : approachCamera(current, goal, 0.18);
        if (camerasAreClose(next, goal)) {
          goalRef.current = null;
          setCamera(goal);
        } else {
          setCamera(next);
          active = true;
        }
      } else if (momentumRef.current) {
        const momentum = momentumRef.current;
        setCamera(current => panCamera(current, momentum.x, momentum.y));
        momentumRef.current = stepMomentum(momentum);
        active = momentumRef.current !== null;
      }

      if (active) frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
  }, []);

  useEffect(
    () => () => {
      // Cleanup is not optional: a surviving frame keeps the whole scene alive.
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      momentumRef.current = null;
      goalRef.current = null;
    },
    []
  );

  const viewportFraction = useCallback((clientX: number, clientY: number) => {
    const host = hostRef.current;
    if (!host) return { x: 0.5, y: 0.5 };
    const rect = host.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / Math.max(1, rect.width),
      y: (clientY - rect.top) / Math.max(1, rect.height),
    };
  }, []);

  const bindRef = useCallback(
    (node: HTMLElement | null) => {
      hostRef.current = node;
    },
    []
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host || disabled) return;

    const rectSize = () => {
      const rect = host.getBoundingClientRect();
      return { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 && event.pointerType === "mouse") return;
      touchesRef.current.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
      if (touchesRef.current.size === 2) {
        const [a, b] = Array.from(touchesRef.current.values());
        pinchRef.current = { distance: touchDistance(a!, b!) };
        pointerRef.current = null;
        return;
      }
      if (touchesRef.current.size > 2) return;
      goalRef.current = null;
      momentumRef.current = null;
      pointerRef.current = {
        id: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
        movedPx: 0,
      };
    };

    const onPointerMove = (event: PointerEvent) => {
      if (touchesRef.current.has(event.pointerId)) {
        touchesRef.current.set(event.pointerId, {
          clientX: event.clientX,
          clientY: event.clientY,
        });
      }

      // Two fingers: pinch, centred on the point between them.
      if (pinchRef.current && touchesRef.current.size === 2) {
        const [a, b] = Array.from(touchesRef.current.values());
        const next = touchDistance(a!, b!);
        const factor = next / Math.max(1, pinchRef.current.distance);
        pinchRef.current = { distance: next };
        const centre = touchCentroid(a!, b!);
        const focus = viewportFraction(centre.clientX, centre.clientY);
        setCamera(current => zoomCameraToward(current, factor, focus));
        event.preventDefault();
        return;
      }

      const pointer = pointerRef.current;
      if (!pointer || pointer.id !== event.pointerId) return;

      const { width, height } = rectSize();
      const dx = (event.clientX - pointer.lastX) / width;
      const dy = (event.clientY - pointer.lastY) / height;
      pointer.movedPx += Math.abs(event.clientX - pointer.lastX) + Math.abs(event.clientY - pointer.lastY);
      pointer.lastX = event.clientX;
      pointer.lastY = event.clientY;

      // Below the threshold this is still a click on a building.
      if (pointer.movedPx < DRAG_THRESHOLD_PX) return;
      if (!draggingRef.current) {
        draggingRef.current = true;
        setIsDragging(true);
      }
      // The world owns this gesture now, so the page must not also scroll.
      event.preventDefault();
      momentumRef.current = { x: dx, y: dy };
      setCamera(current => panCamera(current, -dx, -dy));
    };

    const endPointer = (event: PointerEvent) => {
      touchesRef.current.delete(event.pointerId);
      if (touchesRef.current.size < 2) pinchRef.current = null;
      const pointer = pointerRef.current;
      if (!pointer || pointer.id !== event.pointerId) return;
      pointerRef.current = null;
      draggingRef.current = false;
      setIsDragging(false);
      if (pointer.movedPx >= DRAG_THRESHOLD_PX && momentumRef.current) {
        // Carry the release into a glide that decelerates and stops.
        momentumRef.current = { x: -momentumRef.current.x, y: -momentumRef.current.y };
        ensureLoop();
      } else {
        momentumRef.current = null;
      }
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const focus = viewportFraction(event.clientX, event.clientY);
      const factor = Math.exp(-event.deltaY * 0.0016);
      goalRef.current = null;
      momentumRef.current = null;
      setCamera(current => zoomCameraToward(current, factor, focus));
    };

    host.addEventListener("pointerdown", onPointerDown);
    host.addEventListener("pointermove", onPointerMove, { passive: false });
    host.addEventListener("pointerup", endPointer);
    host.addEventListener("pointercancel", endPointer);
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", endPointer);
      host.removeEventListener("pointercancel", endPointer);
      host.removeEventListener("wheel", onWheel);
      touchesRef.current.clear();
      pinchRef.current = null;
      pointerRef.current = null;
    };
  }, [disabled, ensureLoop, viewportFraction]);

  const focusOn = useCallback(
    (target: { x: number; y: number }, scale = 2.4) => {
      // Remember where we were, so closing the inspector can come back here.
      if (!previousRef.current) previousRef.current = cameraRef.current;
      goalRef.current = focusCameraOn(target, scale);
      momentumRef.current = null;
      ensureLoop();
    },
    [ensureLoop]
  );

  const restore = useCallback(() => {
    const previous = previousRef.current;
    previousRef.current = null;
    if (!previous) return;
    goalRef.current = clampCamera(previous);
    momentumRef.current = null;
    ensureLoop();
  }, [ensureLoop]);

  const reset = useCallback(() => {
    previousRef.current = null;
    goalRef.current = DEFAULT_CAMERA;
    momentumRef.current = null;
    ensureLoop();
  }, [ensureLoop]);

  const zoomBy = useCallback(
    (factor: number) => {
      goalRef.current = null;
      setCamera(current => zoomCameraToward(current, factor, { x: 0.5, y: 0.5 }));
    },
    []
  );

  return {
    camera,
    transform: cameraTransform(camera),
    isDragging,
    focusOn,
    restore,
    reset,
    zoomBy,
    bind: { ref: bindRef },
  };
}
