/**
 * The transition layer, mounted inside the persistent admin shell.
 *
 * `cr-shell` / `ControlRoomNav` / `cr-main-column` already survive admin route
 * changes, so a coordinator living here outlasts the unmount of one world and the
 * mount of the next — which is exactly what a camera move between them requires.
 *
 * STATE COMMITS FIRST, CAMERA FOLLOWS. Beginning a traversal does not delay
 * navigation: the destination renders its real state immediately and this layer
 * animates a copy of the building over the top. Any pointer, key or route change
 * lands the transition instantly in its truthful final state, so no business fact is
 * ever gated behind an animation (DESIGN-LAWS #6).
 *
 * 10-BEAT JOURNEY:
 * 1. Wide LA -> 2. Select Building -> 3. Camera Commitment -> 4. Geographic reality emerges
 * -> 5. Approach -> 6. Fantasy contamination -> 7. Threshold handoff -> 8. Authored building arrival
 * -> 9. Tower Wars weapon/today truth -> 10. Reverse journey
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CanonicalBuildingArt } from "./CanonicalBuildingArt";
import { GoogleMapsRealityLayer } from "./GoogleMapsRealityLayer";
import { trpc } from "@/lib/trpc";
import type { CanonicalBuildingId } from "./buildingArt";
import {
  flipTransform,
  measureRect,
  prefersReducedMotion,
  transitionDuration,
  type TransitionKind,
  type WorldCamera,
  type WorldRect,
} from "./worldTransition";
import { CANONICAL_GEOGRAPHIC_TARGETS } from "./worldTransition";
import { LOS_ANGELES_ESTABLISHING } from "@shared/canonicalGeography";

type Flight = {
  entityId: CanonicalBuildingId;
  kind: TransitionKind;
  from: WorldCamera;
  to: WorldCamera;
  sourceRect: WorldRect;
  destRect: WorldRect;
  reducedMotion: boolean;
  geographicTarget: typeof import("./worldTransition").CANONICAL_GEOGRAPHIC_TARGETS[CanonicalBuildingId];
  phase: "loading" | "reality_ready" | "approach" | "contamination" | "threshold" | "authored_landing";
};

type Pending = {
  entityId: CanonicalBuildingId;
  from: WorldCamera;
  to: WorldCamera;
  sourceRect: WorldRect | null;
  returnPath: string | null;
  reducedMotion: boolean;
  kind: TransitionKind;
};

type Ctx = {
  /** The entity currently being approached, if any. */
  approaching: CanonicalBuildingId | null;
  /** Where a reverse should land. */
  returnPath: string | null;
  begin: (input: {
    entityId: CanonicalBuildingId;
    from: WorldCamera;
    to: WorldCamera;
    sourceEl?: Element | null;
    returnPath?: string | null;
    kind?: TransitionKind;
  }) => void;
  /** A destination calls this once its building has laid out. */
  arrive: (entityId: string, destEl: Element | null) => void;
  cancel: () => void;
  /** True while a destination should hold its HUD back. */
  isArriving: boolean;
};

const WorldTransitionContext = createContext<Ctx>({
  approaching: null,
  returnPath: null,
  begin: () => {},
  arrive: () => {},
  cancel: () => {},
  isArriving: false,
});

export function useWorldTransition() {
  return useContext(WorldTransitionContext);
}

export function WorldTransitionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [landed, setLanded] = useState(false);
  const [phase, setPhase] = useState<Flight["phase"]>("loading");
  const [returnAnchor, setReturnAnchor] = useState<string | null>(null);
  const runtimeConfig = trpc.system.google.runtimeConfig.useQuery(undefined, { staleTime: Infinity });
  const timer = useRef<number | null>(null);
  const phaseTimer = useRef<number | null>(null);

  const clearTimer = () => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (phaseTimer.current != null) {
      window.clearTimeout(phaseTimer.current);
      phaseTimer.current = null;
    }
  };

  const cancel = useCallback(() => {
    clearTimer();
    setPending(null);
    setFlight(null);
    setLanded(false);
    setPhase("loading");
  }, []);

  const begin = useCallback<Ctx["begin"]>(input => {
    setPending({
      entityId: input.entityId,
      from: input.from,
      to: input.to,
      sourceRect: measureRect(input.sourceEl ?? null),
      returnPath: input.returnPath ?? null,
      reducedMotion: prefersReducedMotion(),
      kind: input.kind ?? "traversal",
    });
    if (input.kind !== "reverse") setReturnAnchor(input.returnPath ?? null);
    setLanded(false);
    setPhase("loading");
  }, []);

  const arrive = useCallback<Ctx["arrive"]>((entityId, destEl) => {
    setPending(current => {
      if (!current || current.entityId !== entityId) return current;
      const destRect = measureRect(destEl);
      // No source to fly from (deep link, refresh) — do not fabricate a journey.
      if (!destRect || !current.sourceRect) return null;
      setFlight({
        entityId: current.entityId,
        kind: current.kind,
        from: current.from,
        to: current.to,
        sourceRect: current.sourceRect,
        destRect,
        reducedMotion: current.reducedMotion,
        geographicTarget: CANONICAL_GEOGRAPHIC_TARGETS[current.entityId],
        phase: "loading",
      });
      return null;
    });
  }, []);

  // Start at the source geometry, then release to the destination on the next frame.
  //
  // The teardown below is a SAFETY NET for a journey that never gets going —
  // Maps failing silently, tiles never arriving — and it must not race the
  // authored grammar it exists to protect. It previously fired at a flat 6.5s
  // measured from flight start, but streaming real geography takes ~4.5s to
  // reach `approach` and ~6.3s to reach `contamination`, so the net landed
  // ~200ms into contamination and destroyed the flight before `threshold` and
  // `authored_landing` could ever play. The authored half of the journey was
  // unreachable in practice while every callback still fired.
  //
  // So the net only guards the geographic half. Once contamination begins, the
  // phase machine owns completion and clears the flight itself.
  useEffect(() => {
    if (!flight) return;
    const raf = window.requestAnimationFrame(() => setLanded(true));
    clearTimer();
    const authoredTailRunning =
      phase === "contamination" || phase === "threshold" || phase === "authored_landing";
    if (!authoredTailRunning) {
      timer.current = window.setTimeout(() => {
        setFlight(null);
        setLanded(false);
        setPhase("loading");
        timer.current = null;
      }, flight.reducedMotion ? 2600 : 11000);
    }
    return () => { window.cancelAnimationFrame(raf); clearTimer(); };
  }, [flight, phase]);

  /**
   * The authored half of the journey advances HERE and nowhere else.
   *
   * `onApproachCompleted` used to both set `contamination` and schedule the
   * hop to `threshold`. That timer never survived: committing the new phase
   * re-ran this effect, whose cleanup cleared the timeout the callback had
   * just created, and `contamination` matched no branch here so nothing
   * rescheduled it. The journey stalled on contamination and was eventually
   * torn down by the unrelated 6.5s flight timeout — so the authored threshold
   * and landing, the entire point of the traversal, never played.
   *
   * Keeping every phase hand-off inside this one effect means the cleanup can
   * only ever cancel a timer this effect owns.
   */
  useEffect(() => {
    if (!flight) return;
    // Reduced motion is a different grammar, not a faster version of the same
    // one: real-place confirmation, a brief threshold, then the authored
    // building. It must never wait on a geographic camera flight — doing so
    // meant a reduced-motion user sat on `loading` for the ~4.5s Maps needs to
    // become ready and then got torn down having seen nothing at all. The
    // reality layer is not mounted for these flights either, so we also stop
    // streaming 3D tiles at someone who asked for less movement.
    if (flight.reducedMotion && (phase === "loading" || phase === "reality_ready")) {
      phaseTimer.current = window.setTimeout(() => setPhase("threshold"), 160);
    } else if (phase === "contamination") {
      phaseTimer.current = window.setTimeout(() => setPhase("threshold"), flight.reducedMotion ? 80 : 700);
    } else if (phase === "threshold") {
      phaseTimer.current = window.setTimeout(() => setPhase("authored_landing"), flight.reducedMotion ? 120 : 520);
    } else if (phase === "authored_landing") {
      phaseTimer.current = window.setTimeout(() => { setFlight(null); setLanded(false); setPhase("loading"); }, flight.reducedMotion ? 180 : 700);
    }
    return () => { if (phaseTimer.current != null) { window.clearTimeout(phaseTimer.current); phaseTimer.current = null; } };
  }, [phase, flight]);

  // Any interruption lands the world in its truthful final state.
  useEffect(() => {
    if (!flight && !pending) return;
    const land = () => cancel();
    window.addEventListener("pointerdown", land);
    window.addEventListener("keydown", land);
    return () => {
      window.removeEventListener("pointerdown", land);
      window.removeEventListener("keydown", land);
    };
  }, [flight, pending, cancel]);

  useEffect(() => clearTimer, []);

  const value = useMemo<Ctx>(
    () => ({
      approaching: pending?.entityId ?? flight?.entityId ?? null,
      returnPath: returnAnchor,
      begin,
      arrive,
      cancel,
      isArriving: Boolean(pending || flight),
    }),
    [pending, flight, returnAnchor, begin, arrive, cancel]
  );

  return (
    <WorldTransitionContext.Provider value={value}>
      {children}
      {flight ? (
          <div
          className={`wt-stage phase-${phase} ${landed ? "is-landed" : ""} ${
            flight.reducedMotion ? "is-reduced" : ""
          }`}
            data-world-phase={phase}
            data-world-entity={flight.entityId}
            data-world-reduced={flight.reducedMotion ? "true" : "false"}
            aria-hidden="true"
          >
          {runtimeConfig.data?.mapsJavascriptApiKey && !flight.reducedMotion ? (
            <GoogleMapsRealityLayer
              apiKey={runtimeConfig.data.mapsJavascriptApiKey}
              target={{ latitude: flight.geographicTarget.latitude, longitude: flight.geographicTarget.longitude, altitude: flight.geographicTarget.altitude, range: flight.geographicTarget.range, tilt: flight.geographicTarget.tilt, heading: flight.geographicTarget.heading }}
              mode="maps_js_3d"
              interactive={false}
              initialTarget={{ latitude: LOS_ANGELES_ESTABLISHING.latitude, longitude: LOS_ANGELES_ESTABLISHING.longitude, altitude: 5000, range: 18000, tilt: 35, heading: 0 }}
              onRendererReady={() => setPhase("reality_ready")}
              onApproachStarted={() => setPhase("approach")}
              onApproachCompleted={() => setPhase("contamination")}
              onRendererError={() => setPhase("authored_landing")}
            />
          ) : null}
          {/* Real spatial journey / fantasy contamination FX */}
          {!flight.reducedMotion ? (
            <div className="wt-fantasy-contamination">
              <div className="wt-gold-stream" />
              <div className="wt-spark-burst" />
            </div>
          ) : null}

          <div
            className="wt-flyer"
            style={{
              left: `${flight.destRect.left}px`,
              top: `${flight.destRect.top}px`,
              width: `${flight.destRect.width}px`,
              height: `${flight.destRect.height}px`,
              transitionDuration: `${transitionDuration(flight)}ms`,
              transform: landed
                ? "none"
                : flipTransform(flight.sourceRect, flight.destRect),
            }}
          >
            <CanonicalBuildingArt buildingId={flight.entityId} />
          </div>
        </div>
      ) : null}
    </WorldTransitionContext.Provider>
  );
}
