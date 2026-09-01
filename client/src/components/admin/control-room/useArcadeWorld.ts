/**
 * The playable side of the city, driven by one scheduler.
 *
 * Two things share a single animation loop here: the arcade (weapons, damage,
 * rebuilding) and the idle director (buildings doing something amusing on
 * their own). One loop rather than a timer per building is the whole point —
 * a hundred towers must not mean a hundred intervals.
 *
 * The loop stops itself when there is nothing left to animate, and everything
 * it touches is transient. None of it can reach business truth: the reducer it
 * drives has no way to.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  arcadeIsSettled,
  arcadeReducer,
  EMPTY_ARCADE_WORLD,
  weaponForBuilding,
  WEAPON_PROFILES,
  type ArcadeWorld,
  type WeaponArchetype,
} from "@shared/goldlineArcade";

/**
 * How many buildings may be doing something autonomous at once.
 *
 * Randomness should feel like the city is alive, not like the page is
 * malfunctioning. A small ceiling is what separates "what is that building
 * doing?" from "why is everything flashing?".
 */
const IDLE_CONCURRENCY = 2;
const IDLE_MIN_GAP_MS = 4200;
const IDLE_MAX_GAP_MS = 11000;

export type IdleIncident = {
  physicalEntityId: string;
  kind: "flourish" | "practice" | "machinery";
  startedAt: number;
  durationMs: number;
};

export type ArcadeController = {
  world: ArcadeWorld;
  idle: IdleIncident[];
  /** Play the full shot: anticipation, action, impact, then rebuild. */
  fireAt: (input: {
    shooterId: string;
    targetId: string;
    weapon: WeaponArchetype;
  }) => void;
  isBusy: (physicalEntityId: string) => boolean;
  weaponFor: typeof weaponForBuilding;
};

export function useArcadeWorld(input: {
  /** Buildings currently worth animating. Offscreen places do no work. */
  visibleIds: string[];
  enabled?: boolean;
}): ArcadeController {
  const enabled = input.enabled ?? true;
  const [world, setWorld] = useState<ArcadeWorld>(EMPTY_ARCADE_WORLD);
  const [idle, setIdle] = useState<IdleIncident[]>([]);

  const worldRef = useRef(world);
  worldRef.current = world;
  const idleRef = useRef(idle);
  idleRef.current = idle;
  const visibleRef = useRef(input.visibleIds);
  visibleRef.current = input.visibleIds;

  const frameRef = useRef<number | null>(null);
  const lastRef = useRef(0);
  const nextIdleRef = useRef(0);
  const timersRef = useRef(new Set<number>());
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

  /** Every timeout is tracked so unmount can cancel all of them. */
  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timersRef.current.delete(id);
      fn();
    }, ms);
    timersRef.current.add(id);
    return id;
  }, []);

  const ensureLoop = useCallback(() => {
    if (frameRef.current !== null || !enabled) return;
    lastRef.current = performance.now();
    const step = (now: number) => {
      const delta = Math.min(64, now - lastRef.current);
      lastRef.current = now;

      const next = arcadeReducer(worldRef.current, { type: "tick", deltaMs: delta });
      if (next !== worldRef.current) setWorld(next);

      // Retire idle incidents that have run their course.
      const live = idleRef.current.filter(
        incident => now - incident.startedAt < incident.durationMs
      );
      if (live.length !== idleRef.current.length) setIdle(live);

      /*
        Occasionally let a visible building do something on its own. Bounded by
        concurrency and by a minimum gap, and skipped entirely under reduced
        motion, where surprise movement is exactly what the player asked not
        to have.
      */
      if (
        !reducedMotionRef.current &&
        now >= nextIdleRef.current &&
        live.length < IDLE_CONCURRENCY &&
        visibleRef.current.length > 0
      ) {
        const candidates = visibleRef.current.filter(
          id => !live.some(incident => incident.physicalEntityId === id)
        );
        if (candidates.length) {
          const pick = candidates[Math.floor(Math.random() * candidates.length)]!;
          const kinds: IdleIncident["kind"][] = ["flourish", "practice", "machinery"];
          setIdle([
            ...live,
            {
              physicalEntityId: pick,
              kind: kinds[Math.floor(Math.random() * kinds.length)]!,
              startedAt: now,
              durationMs: 1500,
            },
          ]);
        }
        nextIdleRef.current =
          now + IDLE_MIN_GAP_MS + Math.random() * (IDLE_MAX_GAP_MS - IDLE_MIN_GAP_MS);
      }

      // Stop when there is genuinely nothing left to animate.
      if (arcadeIsSettled(next) && live.length === 0 && enabled) {
        frameRef.current = null;
        return;
      }
      frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
  }, [enabled]);

  /** The idle director needs a heartbeat even when nothing is on fire. */
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => ensureLoop(), 2000);
    return () => window.clearInterval(id);
  }, [enabled, ensureLoop]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      for (const id of Array.from(timersRef.current)) window.clearTimeout(id);
      timersRef.current.clear();
    },
    []
  );

  const fireAt = useCallback(
    ({
      shooterId,
      targetId,
      weapon,
    }: {
      shooterId: string;
      targetId: string;
      weapon: WeaponArchetype;
    }) => {
      const profile = WEAPON_PROFILES[weapon];
      // Anticipation first — the tell is what makes it a shot and not a flash.
      setWorld(current =>
        arcadeReducer(current, { type: "charge", physicalEntityId: shooterId, weapon })
      );
      ensureLoop();

      later(() => {
        setWorld(current => arcadeReducer(current, { type: "fire", physicalEntityId: shooterId }));
        ensureLoop();

        later(() => {
          setWorld(current =>
            arcadeReducer(current, {
              type: "impact",
              physicalEntityId: shooterId,
              targetId,
              force: profile.impactForce,
            })
          );
          ensureLoop();
        }, profile.fireMs);
      }, reducedMotionRef.current ? 80 : profile.chargeMs);
    },
    [ensureLoop, later]
  );

  const isBusy = useCallback(
    (id: string) => {
      const body = world.bodies[id];
      return body?.phase === "charging" || body?.phase === "firing";
    },
    [world]
  );

  return { world, idle, fireAt, isBusy, weaponFor: weaponForBuilding };
}
