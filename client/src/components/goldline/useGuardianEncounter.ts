/**
 * One scheduler for guardian encounters.
 *
 * Same law as the arcade: one animation frame, bounded projectiles, teardown
 * on exit. Reduced motion skips idle attacks and keeps tells as text.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createGuardianWorld,
  guardianIsSettled,
  guardianReducer,
  type GuardianEvent,
  type GuardianWorld,
} from "@shared/goldlineGuardianEngine";
import type { GuardianId } from "@shared/goldlineGuardians";

export function useGuardianEncounter(input: {
  guardianId: GuardianId;
  confrontationReady: boolean;
  enabled: boolean;
  reducedMotion: boolean;
}) {
  const [world, setWorld] = useState<GuardianWorld>(() =>
    createGuardianWorld({
      guardianId: input.guardianId,
      confrontationReady: input.confrontationReady,
    })
  );
  const worldRef = useRef(world);
  worldRef.current = world;
  const frameRef = useRef<number | null>(null);
  const lastRef = useRef(0);

  const dispatch = useCallback((event: GuardianEvent) => {
    const next = guardianReducer(worldRef.current, event);
    worldRef.current = next;
    setWorld(next);
  }, []);

  useEffect(() => {
    dispatch({
      type: "enter",
      guardianId: input.guardianId,
      confrontationReady: input.confrontationReady,
    });
  }, [dispatch, input.guardianId, input.confrontationReady]);

  useEffect(() => {
    dispatch({ type: "ready", confrontationReady: input.confrontationReady });
  }, [dispatch, input.confrontationReady]);

  useEffect(() => {
    if (!input.enabled) {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      return;
    }
    const step = (now: number) => {
      const delta = Math.min(48, now - (lastRef.current || now));
      lastRef.current = now;
      const tick = input.reducedMotion ? Math.min(delta, 8) : delta;
      const next = guardianReducer(worldRef.current, { type: "tick", deltaMs: tick });
      if (next !== worldRef.current) {
        worldRef.current = next;
        setWorld(next);
      }
      if (!guardianIsSettled(next) || input.enabled) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        frameRef.current = null;
      }
    };
    lastRef.current = performance.now();
    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      worldRef.current = guardianReducer(worldRef.current, { type: "exit" });
    };
  }, [input.enabled, input.reducedMotion]);

  return { world, dispatch };
}
