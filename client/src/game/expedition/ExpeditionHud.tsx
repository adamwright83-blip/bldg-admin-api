/**
 * The expedition's on-screen control surface (§13/§14/§45).
 *
 * Exactly two primary interaction zones exist during normal play: the
 * existing movement joystick on the left, and this action pad on the right.
 * There is no third button and no card stack.
 *
 * The pad drives the REAL runtime — every gesture calls a GoldlineGame
 * method, so an E2E test that touches this surface exercises the same code
 * path a thumb does. Nothing here is fixture-only.
 *
 * Entry is explicit (§6 of the continuation brief, and the parked-play
 * contract): a real pickup PREPARES an expedition, but manual combat never
 * begins on its own. The player crosses the threshold deliberately.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ActionPad, HOLD_THRESHOLD_MS } from "./actionPad";

export type ExpeditionHudRuntime = {
  expeditionBeginAim: (radians: number) => void;
  expeditionUpdateAim: (radians: number) => void;
  expeditionCancelAim: () => void;
  expeditionFire: () => boolean;
  expeditionDodge: () => boolean;
  expeditionLockedTargetId: () => string | null;
};

export type ExpeditionHudProps = {
  runtime: ExpeditionHudRuntime | null;
  /** True once the player has explicitly entered the Line. */
  active: boolean;
  onEnter: () => void;
  /** Compact real objective identity — the only business text on screen. */
  objectiveLabel: string;
  hp: number;
  maxHp: number;
  momentum: number;
  maxMomentum: number;
  /** One unobtrusive escape back to the operational surface (§46). */
  onExit: () => void;
};

/** Forward, up the corridor — the aim when the thumb has not been dragged. */
const DEFAULT_AIM_RADIANS = -Math.PI / 2;
/** Below this drag distance the thumb has not expressed a direction. */
const AIM_DEADZONE_PX = 12;

export function ExpeditionHud(props: ExpeditionHudProps) {
  const {
    runtime,
    active,
    onEnter,
    objectiveLabel,
    hp,
    maxHp,
    momentum,
    maxMomentum,
    onExit,
  } = props;

  const padRef = useRef<HTMLDivElement | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const [aiming, setAiming] = useState(false);

  const padModel = useRef(
    new ActionPad({
      onEnterAim: () => setAiming(true),
      onExitAim: () => setAiming(false),
    })
  ).current;

  const aimFrom = useCallback((clientX: number, clientY: number) => {
    const origin = originRef.current;
    if (!origin) return DEFAULT_AIM_RADIANS;
    const dx = clientX - origin.x;
    const dy = clientY - origin.y;
    if (Math.hypot(dx, dy) < AIM_DEADZONE_PX) return DEFAULT_AIM_RADIANS;
    return Math.atan2(dy, dx);
  }, []);

  /**
   * The hold threshold is real elapsed time, so it must be polled — a
   * motionless thumb produces no pointermove and would otherwise never
   * cross into aim.
   */
  const pump = useCallback(
    (clientX: number, clientY: number) => {
      if (!runtime) return;
      const wasAiming = padModel.isAiming();
      padModel.pointerUpdate(performance.now(), aimFrom(clientX, clientY));
      if (padModel.isAiming()) {
        if (!wasAiming) runtime.expeditionBeginAim(padModel.getAimRadians());
        else runtime.expeditionUpdateAim(padModel.getAimRadians());
        padModel.setLockedTargetId(runtime.expeditionLockedTargetId());
      }
    },
    [runtime, aimFrom, padModel]
  );

  const moveListenerRef = useRef<((e: PointerEvent) => void) | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;

  /**
   * ONE cleanup path for every way a hold can end. Unmounting mid-hold
   * previously cancelled only the RAF loop and left the window pointermove
   * listener attached — a real risk if the component unmounts (route
   * change, expedition ending) while a finger is still down, which would
   * both leak the listener and strand the fictional clock dilated at 0.2x
   * from an aim that never formally ended.
   */
  const cleanupPointer = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (moveListenerRef.current) {
      window.removeEventListener("pointermove", moveListenerRef.current);
      moveListenerRef.current = null;
    }
    activePointerIdRef.current = null;
    originRef.current = null;
    padModel.cancel();
    runtimeRef.current?.expeditionCancelAim();
  }, [padModel]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!runtime) return;
      event.preventDefault();
      padRef.current?.setPointerCapture(event.pointerId);
      activePointerIdRef.current = event.pointerId;
      originRef.current = { x: event.clientX, y: event.clientY };
      padModel.pointerDown(performance.now(), DEFAULT_AIM_RADIANS);

      const last = { x: event.clientX, y: event.clientY };
      const tick = () => {
        pump(last.x, last.y);
        rafRef.current = requestAnimationFrame(tick);
      };
      const move = (e: PointerEvent) => {
        // Ignore any touch that is not the one that started this hold.
        if (e.pointerId !== activePointerIdRef.current) return;
        last.x = e.clientX;
        last.y = e.clientY;
      };
      moveListenerRef.current = move;
      window.addEventListener("pointermove", move);
      rafRef.current = requestAnimationFrame(tick);
    },
    [runtime, padModel, pump]
  );

  const finish = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!runtime) return;
      if (event.pointerId !== activePointerIdRef.current) return;

      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (moveListenerRef.current) {
        window.removeEventListener("pointermove", moveListenerRef.current);
        moveListenerRef.current = null;
      }
      activePointerIdRef.current = null;

      const resolution = padModel.pointerUp(performance.now());
      originRef.current = null;

      if (resolution.kind === "dodge") {
        runtime.expeditionDodge();
      } else if (resolution.kind === "fire") {
        runtime.expeditionFire();
      } else if (resolution.kind === "cancel") {
        // No valid target: return cleanly to movement. Never a substitute
        // dodge — a silent swapped verb is what makes controls feel untrue.
        runtime.expeditionCancelAim();
      }
    },
    [runtime, padModel]
  );

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerId !== activePointerIdRef.current) return;
      cleanupPointer();
    },
    [cleanupPointer]
  );

  useEffect(() => cleanupPointer, [cleanupPointer]);

  if (!active) {
    return (
      <div className="expedition-threshold" data-testid="expedition-threshold">
        <p className="expedition-threshold__objective">{objectiveLabel}</p>
        <p className="expedition-threshold__ready">EXPEDITION READY</p>
        <button
          type="button"
          className="expedition-threshold__enter"
          data-testid="expedition-enter"
          onClick={onEnter}
        >
          ENTER THE LINE
        </button>
      </div>
    );
  }

  const hpPct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
  const momentumPct = Math.max(0, Math.min(100, (momentum / maxMomentum) * 100));

  return (
    <div className="expedition-hud" data-testid="expedition-hud">
      <div className="expedition-hud__status">
        <span
          className="expedition-hud__objective"
          data-testid="expedition-objective"
        >
          {objectiveLabel}
        </span>
        <span className="expedition-hud__bar expedition-hud__bar--hp">
          <span style={{ width: `${hpPct}%` }} data-testid="expedition-hp" />
        </span>
        <span className="expedition-hud__bar expedition-hud__bar--momentum">
          <span
            style={{ width: `${momentumPct}%` }}
            data-testid="expedition-momentum"
          />
        </span>
      </div>

      <button
        type="button"
        className="expedition-hud__exit"
        data-testid="expedition-exit"
        onClick={onExit}
        aria-label="Leave the expedition and return to the field console"
      >
        ✕
      </button>

      <div
        ref={padRef}
        className={`expedition-pad${aiming ? " is-aiming" : ""}`}
        data-testid="expedition-action-pad"
        data-aiming={aiming ? "true" : "false"}
        onPointerDown={handlePointerDown}
        onPointerUp={finish}
        onPointerCancel={handlePointerCancel}
        role="button"
        aria-label="Action pad: tap to evade, hold to aim the Line"
      >
        <span className="expedition-pad__label">
          {aiming ? "LINE" : "ACT"}
        </span>
      </div>
    </div>
  );
}

export { HOLD_THRESHOLD_MS };
