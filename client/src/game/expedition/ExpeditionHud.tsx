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
import { ActionPad, HOLD_THRESHOLD_MS, MOVEMENT_DEADZONE_PX } from "./actionPad";

export type ExpeditionHudRuntime = {
  expeditionBeginAim: (radians: number) => void;
  expeditionUpdateAim: (radians: number) => void;
  expeditionCancelAim: () => void;
  expeditionFire: () => boolean;
  expeditionDodge: () => boolean;
  /** Deliberate tap — the player's primary offensive verb (§PR77). */
  expeditionStrike: () => boolean;
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
  /**
   * §PR77 Part 17. The compact objective is interactive: tapping it opens a
   * lightweight, secondary mission-context surface rather than replacing
   * the game with a dashboard. This is the detail line shown there (e.g.
   * an address or a task's free-text detail) — never re-derived, always
   * whatever the caller already resolved for this exact objective.
   */
  objectiveDetail?: string | null;
  /**
   * Present only when the detail is a genuine, navigable address (native
   * pickups and external orders carry one; an Open Channel task's detail
   * is free text and must not be offered as a destination).
   */
  objectiveNavigationUrl?: string | null;
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
  /**
   * Capture a field observation from the doorstep. Optional because the
   * expedition is playable without it — a missing capture surface must never
   * be able to block recording that the real work happened.
   */
  onLogSignal?: () => void;
  /**
   * §PR77 Part 4 contextual teaching — the single next mechanic the player
   * has not yet performed, or null once every mechanic is learned (or none
   * is currently relevant). Never a persistent tutorial manual: this is
   * the one hint shown at a time, and it retires the moment the caller
   * reports the real verb succeeded — never merely from having displayed.
   */
  teachingHint?: string | null;
};

/** Forward, up the corridor — the aim when the thumb has not been dragged. */
const DEFAULT_AIM_RADIANS = -Math.PI / 2;

export function ExpeditionHud(props: ExpeditionHudProps) {
  const {
    runtime,
    active,
    onEnter,
    objectiveLabel,
    objectiveDetail = null,
    objectiveNavigationUrl = null,
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
    onLogSignal,
    teachingHint = null,
  } = props;

  const padRef = useRef<HTMLDivElement | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const deniedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [aiming, setAiming] = useState(false);
  /**
   * §PR77 no dead press: a flick can resolve to a legitimate EVADE gesture
   * that the runtime nonetheless rejects (dodge on cooldown). Silence in
   * that case reads as a broken control, not a fair no-op — this drives a
   * brief visible "rejected" state on the pad itself.
   */
  const [gestureDenied, setGestureDenied] = useState(false);

  const flashDenied = useCallback(() => {
    if (deniedTimeoutRef.current != null) clearTimeout(deniedTimeoutRef.current);
    setGestureDenied(true);
    deniedTimeoutRef.current = setTimeout(() => setGestureDenied(false), 180);
  }, []);

  /** Mirrors padModel's lock so the label can say RELEASE · HOOK live. */
  const [locked, setLocked] = useState(false);

  /**
   * §PR77 Part 17. Secondary, on-demand context — never a replacement for
   * the game. Closed whenever the run leaves the RUNNING state so it can
   * never linger open over a terminal (down/arrived) screen it predates.
   */
  const [missionSheetOpen, setMissionSheetOpen] = useState(false);
  useEffect(() => {
    if (terminalState !== "running") setMissionSheetOpen(false);
  }, [terminalState]);

  const padModel = useRef(
    new ActionPad({
      onEnterAim: () => setAiming(true),
      onExitAim: () => {
        setAiming(false);
        setLocked(false);
      },
    })
  ).current;

  /** Straight-line px distance from the press origin, or 0 with no origin. */
  const distanceFrom = useCallback((clientX: number, clientY: number) => {
    const origin = originRef.current;
    if (!origin) return 0;
    return Math.hypot(clientX - origin.x, clientY - origin.y);
  }, []);

  const aimFrom = useCallback(
    (clientX: number, clientY: number, distancePx: number) => {
      const origin = originRef.current;
      if (!origin || distancePx < MOVEMENT_DEADZONE_PX) return DEFAULT_AIM_RADIANS;
      return Math.atan2(clientY - origin.y, clientX - origin.x);
    },
    []
  );

  /**
   * The hold threshold is real elapsed time, so it must be polled — a
   * motionless thumb produces no pointermove and would otherwise never
   * cross into aim.
   */
  const pump = useCallback(
    (clientX: number, clientY: number) => {
      if (!runtime) return;
      const wasAiming = padModel.isAiming();
      const distancePx = distanceFrom(clientX, clientY);
      padModel.pointerUpdate(
        performance.now(),
        aimFrom(clientX, clientY, distancePx),
        distancePx
      );
      if (padModel.isAiming()) {
        if (!wasAiming) runtime.expeditionBeginAim(padModel.getAimRadians());
        else runtime.expeditionUpdateAim(padModel.getAimRadians());
        padModel.setLockedTargetId(runtime.expeditionLockedTargetId());
        // RELEASE · HOOK only appears once a lock genuinely exists — read
        // the pad model itself rather than trusting the runtime's raw
        // value, since setLockedTargetId is what actually took effect.
        setLocked(padModel.getLockedTargetId() != null);
      }
    },
    [runtime, aimFrom, distanceFrom, padModel]
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

      if (resolution.kind === "strike") {
        runtime.expeditionStrike();
      } else if (resolution.kind === "dodge") {
        // A flick is always a legitimate gesture, but the runtime can
        // still decline it (dodge on cooldown). That must not read as
        // silence — flash the pad's rejected state instead.
        if (!runtime.expeditionDodge()) flashDenied();
      } else if (resolution.kind === "fire") {
        runtime.expeditionFire();
      } else if (resolution.kind === "cancel") {
        // No valid target: return cleanly to movement. Never a substitute
        // dodge — a silent swapped verb is what makes controls feel untrue.
        runtime.expeditionCancelAim();
      }
    },
    [runtime, padModel, flashDenied]
  );

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerId !== activePointerIdRef.current) return;
      cleanupPointer();
    },
    [cleanupPointer]
  );

  useEffect(() => cleanupPointer, [cleanupPointer]);
  useEffect(
    () => () => {
      if (deniedTimeoutRef.current != null) clearTimeout(deniedTimeoutRef.current);
    },
    []
  );

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
        {/*
          §PR77 Part 17. ONE compact objective owner during active
          gameplay, and it is interactive: tapping it opens secondary
          context rather than replacing the game with a dashboard.
        */}
        <button
          type="button"
          className="expedition-hud__objective"
          data-testid="expedition-objective"
          onClick={() => setMissionSheetOpen(open => !open)}
          aria-expanded={missionSheetOpen}
          aria-label={`Objective: ${objectiveLabel}. Tap for details.`}
        >
          {objectiveLabel}
        </button>
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

      {/*
        §PR77 Part 4 contextual teaching. Exactly one hint at a time, only
        while gameplay is genuinely running, retiring the instant the real
        verb succeeds — never a persistent tutorial manual over the world.
      */}
      {terminalState === "running" && teachingHint ? (
        <p
          className="expedition-hud__teaching-hint"
          data-testid="expedition-teaching-hint"
        >
          {teachingHint}
        </p>
      ) : null}

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
        §PR77 Part 17 mission-context sheet. Secondary and on-demand: the
        long/original briefing lives here, not continuously repeated over
        the playfield. Never blocks or replaces MOVE/the pad — it is closed
        the instant the run leaves RUNNING (see the effect above).
      */}
      {missionSheetOpen && terminalState === "running" ? (
        <div
          className="expedition-mission-sheet"
          data-testid="expedition-mission-sheet"
          role="dialog"
          aria-label="Mission context"
        >
          <div
            className="expedition-mission-sheet__backdrop"
            onClick={() => setMissionSheetOpen(false)}
          />
          <div className="expedition-mission-sheet__card">
            <button
              type="button"
              className="expedition-mission-sheet__close"
              data-testid="expedition-mission-sheet-close"
              onClick={() => setMissionSheetOpen(false)}
              aria-label="Close mission context"
            >
              ✕
            </button>
            <p className="expedition-mission-sheet__label">{objectiveLabel}</p>
            {provenanceLabel ? (
              <p className="expedition-mission-sheet__provenance">
                {provenanceLabel}
              </p>
            ) : null}
            {objectiveDetail ? (
              <p
                className="expedition-mission-sheet__detail"
                data-testid="expedition-mission-sheet-detail"
              >
                {objectiveDetail}
              </p>
            ) : null}
            {objectiveNavigationUrl ? (
              <a
                className="expedition-mission-sheet__navigate"
                data-testid="expedition-mission-sheet-navigate"
                href={objectiveNavigationUrl}
                target="_blank"
                rel="noreferrer"
              >
                NAVIGATE
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {/*
        RUNNING is MOVE + ACT and nothing more. The pad is removed outright
        in a terminal state rather than disabled, so a downed or arrived
        player cannot keep poking a control that no longer means anything.
      */}
      {terminalState === "running" ? (
        <div
          ref={padRef}
          className={`expedition-pad${aiming ? " is-aiming" : ""}${
            locked ? " is-locked" : ""
          }${gestureDenied ? " is-denied" : ""}`}
          data-testid="expedition-action-pad"
          data-aiming={aiming ? "true" : "false"}
          data-locked={locked ? "true" : "false"}
          data-denied={gestureDenied ? "true" : "false"}
          onPointerDown={handlePointerDown}
          onPointerUp={finish}
          onPointerCancel={handlePointerCancel}
          role="button"
          aria-label="Action pad: tap to strike, flick to evade, hold to aim the Line"
        >
          {/*
            No undocumented "ACT" semantics (§PR77 Part 3). Default state
            names the player's primary verb outright and hints at the other
            two gestures without a third button; aiming replaces all three
            with exactly what release will do right now.
          */}
          <span
            className="expedition-pad__label"
            data-testid="expedition-pad-label"
          >
            {aiming ? (locked ? "RELEASE · HOOK" : "AIM THE LINE") : "STRIKE"}
          </span>
          {!aiming ? (
            <span className="expedition-pad__hints" aria-hidden="true">
              <span className="expedition-pad__hint">FLICK · EVADE</span>
              <span className="expedition-pad__hint">HOLD · LINE</span>
            </span>
          ) : null}
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

          {/*
            The doorstep. This is the one screen in the whole app that knows
            both that the operator is standing somewhere and exactly where that
            is — it is pinning the customer and the address two lines up.
            Everything worth capturing during the ten-day run is noticed here,
            and the operating bar that normally carries capture is hidden for
            the duration of a run, so without this the surface is unreachable
            at precisely the moment it matters.

            Deliberately secondary and below the completion action: recording
            the work is still the point of arriving.
          */}
          {onLogSignal ? (
            <button
              type="button"
              className="expedition-terminal__signal"
              data-testid="expedition-log-signal"
              onClick={onLogSignal}
            >
              LOG A SIGNAL
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export { HOLD_THRESHOLD_MS };
