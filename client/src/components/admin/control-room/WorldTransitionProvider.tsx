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

type Flight = {
  entityId: CanonicalBuildingId;
  kind: TransitionKind;
  from: WorldCamera;
  to: WorldCamera;
  sourceRect: WorldRect;
  destRect: WorldRect;
  reducedMotion: boolean;
};

type Pending = {
  entityId: CanonicalBuildingId;
  from: WorldCamera;
  to: WorldCamera;
  sourceRect: WorldRect | null;
  returnPath: string | null;
  reducedMotion: boolean;
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
  const timer = useRef<number | null>(null);

  const clearTimer = () => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const cancel = useCallback(() => {
    clearTimer();
    setPending(null);
    setFlight(null);
    setLanded(false);
  }, []);

  const begin = useCallback<Ctx["begin"]>(input => {
    setPending({
      entityId: input.entityId,
      from: input.from,
      to: input.to,
      sourceRect: measureRect(input.sourceEl ?? null),
      returnPath: input.returnPath ?? null,
      reducedMotion: prefersReducedMotion(),
    });
    setLanded(false);
  }, []);

  const arrive = useCallback<Ctx["arrive"]>((entityId, destEl) => {
    setPending(current => {
      if (!current || current.entityId !== entityId) return current;
      const destRect = measureRect(destEl);
      // No source to fly from (deep link, refresh) — do not fabricate a journey.
      if (!destRect || !current.sourceRect) return null;
      setFlight({
        entityId: current.entityId,
        kind: "traversal",
        from: current.from,
        to: current.to,
        sourceRect: current.sourceRect,
        destRect,
        reducedMotion: current.reducedMotion,
      });
      return null;
    });
  }, []);

  // Start at the source geometry, then release to the destination on the next frame.
  useEffect(() => {
    if (!flight) return;
    const raf = window.requestAnimationFrame(() => setLanded(true));
    clearTimer();
    timer.current = window.setTimeout(() => {
      setFlight(null);
      setLanded(false);
      timer.current = null;
    }, transitionDuration(flight) + 40);
    return () => window.cancelAnimationFrame(raf);
  }, [flight]);

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
      returnPath: pending?.returnPath ?? null,
      begin,
      arrive,
      cancel,
      isArriving: Boolean(pending || flight),
    }),
    [pending, flight, begin, arrive, cancel]
  );

  return (
    <WorldTransitionContext.Provider value={value}>
      {children}
      {flight ? (
        <div
          className={`wt-stage ${landed ? "is-landed" : ""} ${
            flight.reducedMotion ? "is-reduced" : ""
          }`}
          aria-hidden="true"
        >
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
