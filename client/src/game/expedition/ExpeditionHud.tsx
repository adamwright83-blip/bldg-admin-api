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

/**
 * What the run is doing right now. RUNNING is MOVE + ACT and nothing else;
 * the two terminal states are the only time this surface says more.
 */
export type ExpeditionTerminalState = "running" | "down" | "arrived";

/**
 * The verification phase of the pickup. `verifying` is deliberately its own
 * state rather than an optimistic success: the canonical mutation returning
 * is not the same fact as the order being collected, and this surface must
 * not claim otherwise.
 */
export type CargoPhase = "idle" | "verifying" | "failed";

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
  terminalState?: ExpeditionTerminalState;
  onRedeploy?: () => void;
  onPressOn?: () => void;
  /**
   * The PINNED customer and address for this expedition's real order. Shown
   * only on arrival, and only ever read from the order the run was bound to
   * at ENTER — never re-derived from a live list that may have moved on.
   */
  pinnedCustomer?: string;
  pinnedAddress?: string;
  onSecureCargo?: () => void;
  cargoPhase?: CargoPhase;
  /**
   * AUTHORITATIVE. True only once server truth says the pinned order is
   * genuinely collected — never set from the mutation returning.
   */
  cargoSecured?: boolean;
  completionActionLabel?: string;
  confirmedLabel?: string;
  verifyingLabel?: string;
  failedLabel?: string;
  /**
   * Which system owns this objective. Native work says nothing; externally
   * managed work is marked so the operator can never mistake it for an order
   * this business originated.
   */
  provenanceLabel?: string | null;
  /**
   * What the operator still owes the owning system after the physical work is
   * done — e.g. "CLEAN CLOUD · UPDATE REQUIRED". Never a claim that this app
   * checked anything.
   */
  reconciliationLabel?: string | null;
  /** Present only while an external update is genuinely outstanding. */
  onReconcile?: () => void;
  reconcileActionLabel?: string;
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
    terminalState = "running",
    onRedeploy,
    onPressOn,
    pinnedCustomer,
    pinnedAddress,
    onSecureCargo,
    cargoPhase = "idle",
    cargoSecured = false,
    completionActionLabel = "SECURE CARGO",
    confirmedLabel = "CARGO SECURED",
    verifyingLabel = "VERIFYING SERVER TRUTH",
    failedLabel = "PICKUP NOT RECORDED — STILL PENDING",
    provenanceLabel = null,
    reconciliationLabel = null,
    onReconcile,
    reconcileActionLabel = "I UPDATED IT",
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
      // One action-pad gesture owns exactly one pointer. A second finger
      // landing mid-hold must not hijack the aim/dodge state a first
      // finger already started.
      if (activePointerIdRef.current != null) return;
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
        {provenanceLabel ? (
          <p
            className="expedition-threshold__provenance"
            data-testid="expedition-provenance"
          >
            {provenanceLabel}
          </p>
        ) : null}
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

      {/*
        RUNNING is MOVE + ACT and nothing more. The pad is removed outright
        in a terminal state rather than disabled, so a downed or arrived
        player cannot keep poking a control that no longer means anything.
      */}
      {terminalState === "running" ? (
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
      ) : null}

      {/*
        §33/§34. Being defeated is an EXPEDITION loss. The real pickup is
        exactly as pending as it was a second ago, and both ways forward say
        so — neither of these touches business truth.
      */}
      {terminalState === "down" ? (
        <div className="expedition-terminal" data-testid="expedition-down">
          <p className="expedition-terminal__headline">TRAILBLAZER DOWN</p>
          <div className="expedition-terminal__choices">
            <button
              type="button"
              data-testid="expedition-redeploy"
              onClick={onRedeploy}
            >
              REDEPLOY
            </button>
            <button
              type="button"
              data-testid="expedition-press-on"
              onClick={onPressOn}
            >
              PRESS ON
            </button>
          </div>
        </div>
      ) : null}

      {/*
        ARRIVED. The pinned customer and address are the real business facts
        this whole run was for, and SECURE CARGO is the one control that
        touches them.

        The three states below are deliberately distinct. VERIFYING is not a
        spinner over a success we already assumed — it is the honest report
        that the write landed and server truth has not yet confirmed the
        collection. CARGO SECURED appears only when authoritative evidence
        says the order really is collected, which is why it is driven by
        `cargoSecured` and never by the mutation returning.
      */}
      {terminalState === "arrived" ? (
        <div className="expedition-terminal" data-testid="expedition-arrived">
          <p
            className="expedition-terminal__customer"
            data-testid="expedition-pinned-customer"
          >
            {pinnedCustomer}
          </p>
          <p
            className="expedition-terminal__address"
            data-testid="expedition-pinned-address"
          >
            {pinnedAddress}
          </p>

          {provenanceLabel ? (
            <p
              className="expedition-terminal__provenance"
              data-testid="expedition-provenance"
            >
              {provenanceLabel}
            </p>
          ) : null}

          {cargoSecured ? (
            <>
              <p
                className="expedition-terminal__headline is-secured"
                data-testid="cargo-secured"
              >
                {confirmedLabel}
              </p>
              {/*
                The second, separate statement. CARGO SECURED is about the
                bag; this is about the other system's books. They are shown
                apart because they are different facts, and merging them would
                let a secured pickup imply CleanCloud had been told.
              */}
              {reconciliationLabel ? (
                <p
                  className="expedition-terminal__reconciliation"
                  data-testid="external-reconciliation"
                >
                  {reconciliationLabel}
                </p>
              ) : null}
              {onReconcile ? (
                <button
                  type="button"
                  className="expedition-terminal__reconcile"
                  data-testid="external-reconcile"
                  onClick={onReconcile}
                >
                  {reconcileActionLabel}
                </button>
              ) : null}
            </>
          ) : cargoPhase === "verifying" ? (
            <p
              className="expedition-terminal__verifying"
              data-testid="cargo-verifying"
            >
              {verifyingLabel}
            </p>
          ) : (
            <>
              {cargoPhase === "failed" ? (
                <p
                  className="expedition-terminal__failed"
                  data-testid="cargo-failed"
                >
                  {failedLabel}
                </p>
              ) : null}
              <button
                type="button"
                className="expedition-terminal__secure"
                data-testid="secure-cargo"
                onClick={onSecureCargo}
              >
                {completionActionLabel}
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export { HOLD_THRESHOLD_MS };
