import { useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { evaluateMachineRoute, MACHINE_NODES } from "./machineGraph";
import { hydrateMachineStateFromChapter, type StoredMachineProgress } from "./machinePersistence";
import { reduceMachineState } from "./machineState";
import type {
  MachineBusinessAdapter,
  MachineEngineState,
  MachinePoint,
} from "./machineTypes";
import { MachineControls } from "./MachineControls";
import { MachineCorrespondence } from "./MachineCorrespondence";
import { MachineEnding } from "./MachineEnding";
import { MachineRailway } from "./MachineRailway";
import { MachineRook } from "./MachineRook";
import styles from "./impossibleMachine.module.css";

export type CameraFocus = "full" | "west" | "center" | "east";

interface MachineBoardProps {
  adapter: MachineBusinessAdapter;
  initialProgress?: Partial<StoredMachineProgress> | null;
  children?: React.ReactNode;
}

/**
 * The complete interactive 1280 x 720 tabletop scene for THE IMPOSSIBLE MACHINE.
 * Coordinates the pure puzzle state machine, continuous carriage spline travel,
 * multi-layered Rook dome unlock sequence, mobile camera focus/zoom controls,
 * and integrated center correspondence drawer.
 */
export function MachineBoard({ adapter, initialProgress = null, children }: MachineBoardProps) {
  const reduce = useReducedMotion();

  const [state, setState] = useState<MachineEngineState>(() =>
    hydrateMachineStateFromChapter(
      {
        opportunity: adapter.opportunity,
        progress: { revealed: false, steps: [], letterWritten: false },
        draft: adapter.draft,
      },
      initialProgress
    )
  );

  const [carriagePos, setCarriagePos] = useState<MachinePoint>(() =>
    state.keyRetrieved && !state.domeUnlocked
      ? MACHINE_NODES.key_station
      : MACHINE_NODES.rook_dome
  );
  const [carriageBumped, setCarriageBumped] = useState(false);
  const [crankSpinning, setCrankSpinning] = useState(false);
  const [traveling, setTraveling] = useState(false);
  const [correspondenceOpen, setCorrespondenceOpen] = useState<boolean>(() =>
    Boolean(adapter.draft || initialProgress?.centerExamined || initialProgress?.correspondenceChoice)
  );
  const [unlockStage, setUnlockStage] = useState<
    "locked" | "key_inserted" | "tumblers_turning" | "dome_lifting" | "escaped" | "stealing"
  >(() => (state.adventureCompleted ? "stealing" : state.domeUnlocked ? "escaped" : "locked"));
  const [cameraFocus, setCameraFocus] = useState<CameraFocus>("full");

  const timersRef = useRef<number[]>([]);
  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  useEffect(() => {
    if (adapter.draft) setCorrespondenceOpen(true);
  }, [adapter.draft]);

  // Synchronize verified send status from the business adapter into the pure puzzle engine
  useEffect(() => {
    const draftStatus = adapter.draft?.status ?? null;
    setState(prev => {
      const next = reduceMachineState(prev, { type: "SYNC_DRAFT_STATUS", draftStatus });
      if (!prev.centerBridgeRestored && next.centerBridgeRestored) {
        void adapter.onRecordMilestone({ milestone: "center_restored" }).catch(() => undefined);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter.draft?.status]);

  const animateCarriageAlong = useCallback(
    (points: MachinePoint[], stepMs: number, onDone: () => void) => {
      if (points.length === 0) {
        onDone();
        return;
      }
      if (reduce) {
        setCarriagePos(points[points.length - 1]);
        const id = window.setTimeout(onDone, 40);
        timersRef.current.push(id);
        return;
      }
      points.forEach((pt, idx) => {
        const id = window.setTimeout(() => {
          setCarriagePos(pt);
          if (idx === points.length - 1) {
            const finishId = window.setTimeout(onDone, stepMs);
            timersRef.current.push(finishId);
          }
        }, idx * stepMs);
        timersRef.current.push(id);
      });
    },
    [reduce]
  );

  const handleWindCrank = useCallback(() => {
    if (traveling || state.domeUnlocked) return;
    clearTimers();
    setCrankSpinning(true);
    setCarriageBumped(false);

    const attempt = evaluateMachineRoute(state);
    setState(prev => reduceMachineState(prev, { type: "WIND_CRANK" }));

    const origin = state.keyRetrieved ? MACHINE_NODES.key_station : MACHINE_NODES.rook_dome;

    if (!attempt.connected) {
      // Failed route: carriage travels to the disconnected point, reacts comically, and returns to start
      setTraveling(true);
      const stepMs = reduce ? 20 : 180;
      animateCarriageAlong(attempt.pathPoints, stepMs, () => {
        setCarriageBumped(true);
        const returnId = window.setTimeout(() => {
          setCarriageBumped(false);
          setCarriagePos(origin);
          setCrankSpinning(false);
          setTraveling(false);
        }, reduce ? 50 : 480);
        timersRef.current.push(returnId);
      });
      return;
    }

    if (!state.keyRetrieved) {
      // State C -> State D: Outbound route solved! Travel to key station, collect key, shift machine to NOW
      setTraveling(true);
      const stepMs = reduce ? 20 : 190;
      animateCarriageAlong(attempt.pathPoints, stepMs, () => {
        setCrankSpinning(false);
        setTraveling(false);
        setState(prev => reduceMachineState(prev, { type: "COMPLETE_OUTBOUND_TRAVEL" }));
        void adapter.onRecordMilestone({ milestone: "key_retrieved" }).catch(() => undefined);
      });
      return;
    }

    // State G or H -> State I: Return route solved! Travel back to Rook's dome, unlock dome, Rook escapes & steals
    setTraveling(true);
    const stepMs = reduce ? 20 : 190;
    const routeUsed = attempt.activeRoute === "center" ? "center" : "lower";
    animateCarriageAlong(attempt.pathPoints, stepMs, () => {
      setCrankSpinning(false);
      setUnlockStage("key_inserted");
      const t1 = window.setTimeout(() => {
        setUnlockStage("tumblers_turning");
      }, reduce ? 20 : 280);
      const t2 = window.setTimeout(() => {
        setUnlockStage("dome_lifting");
        setState(prev => reduceMachineState(prev, { type: "COMPLETE_RETURN_TRAVEL" }));
        void adapter
          .onRecordMilestone({ milestone: "return_completed", route: routeUsed })
          .catch(() => undefined);
        void adapter.onRecordMilestone({ milestone: "rook_rescued" }).catch(() => undefined);
      }, reduce ? 40 : 600);
      const t3 = window.setTimeout(() => {
        setUnlockStage("escaped");
      }, reduce ? 60 : 950);
      const t4 = window.setTimeout(() => {
        setUnlockStage("stealing");
        setTraveling(false);
        setState(prev => reduceMachineState(prev, { type: "COMPLETE_DOME_UNLOCK" }));
        void adapter.onRecordMilestone({ milestone: "adventure_completed" }).catch(() => undefined);
      }, reduce ? 80 : 1350);
      timersRef.current.push(t1, t2, t3, t4);
    });
  }, [adapter, animateCarriageAlong, clearTimers, reduce, state, traveling]);

  const handleExamineCenter = useCallback(() => {
    setState(prev => reduceMachineState(prev, { type: "EXAMINE_CENTER" }));
    setCorrespondenceOpen(true);
    void adapter.onRecordMilestone({ milestone: "center_examined" }).catch(() => undefined);
  }, [adapter]);

  const handleCorrespondenceChoice = useCallback(
    async (choice: "prepare_reply" | "keep_for_later" | "not_for_me") => {
      setState(prev => reduceMachineState(prev, { type: "CHOOSE_CORRESPONDENCE", choice }));
      await adapter.onRecordChoice(choice);
      if (choice === "prepare_reply") {
        await adapter.onPrepareDraft();
        void adapter.onRecordMilestone({ milestone: "choice_prepare_reply" }).catch(() => undefined);
      } else if (choice === "keep_for_later") {
        void adapter.onRecordMilestone({ milestone: "choice_keep_for_later" }).catch(() => undefined);
      } else {
        if (adapter.draft) {
          await adapter.onDeclineDraft();
        }
        void adapter.onRecordMilestone({ milestone: "choice_not_for_me" }).catch(() => undefined);
      }
    },
    [adapter]
  );

  const routeEval = evaluateMachineRoute(state);

  return (
    <section
      className={styles.machineSection}
      data-testid="first-ten-impossible-machine"
      data-phase={state.phase}
      data-dial={state.dial}
      data-key-retrieved={state.keyRetrieved ? "yes" : "no"}
      data-center-restored={state.centerBridgeRestored ? "yes" : "no"}
      data-dome-unlocked={state.domeUnlocked ? "yes" : "no"}
      data-rook-stealing={state.rookStealing ? "yes" : "no"}
    >
      {/* Top Status & Mobile Camera Focus Bar */}
      <div className={styles.topUtilityBar}>
        <div className={styles.statusReadout} data-testid="machine-status-readout">
          <span className={styles.machineTitleBadge}>THE IMPOSSIBLE MACHINE</span>
          <span className={styles.machineObjectiveText}>
            {!state.keyRetrieved
              ? "Outbound (THEN): Align the upper railway to fetch the brass key."
              : !state.domeUnlocked
                ? state.centerBridgeRestored
                  ? "Return (NOW): Central crossing coupled! Point junctions Center or use the lower NOW track."
                  : "Return (NOW): Upper gate locked. Inspect the center note or align the lower NOW rotor."
                : "Rescue complete: Rook is out of the dome."}
          </span>
        </div>

        {/* Mobile / Touch Camera Focus Controls */}
        <div className={styles.cameraControls} role="group" aria-label="Board view focus">
          {(["full", "west", "center", "east"] as const).map(view => (
            <button
              key={view}
              type="button"
              className={`${styles.cameraBtn} ${cameraFocus === view ? styles.cameraBtnActive : ""}`}
              onClick={() => setCameraFocus(view)}
              data-testid={`machine-camera-${view}`}
            >
              {view === "full"
                ? "Full Board"
                : view === "west"
                  ? "Dome & West"
                  : view === "center"
                    ? "Center & Rotors"
                    : "East & Key"}
            </button>
          ))}
        </div>
      </div>

      {/* Main 1280x720 Responsive Viewport */}
      <div className={styles.viewportFrame} data-camera={cameraFocus}>
        <div className={`${styles.boardStage} ${styles[`camera_${cameraFocus}`]}`} data-testid="machine-board-stage">
          {/* Layer 1: Environment Background */}
          <img
            src="/assets/first-ten/impossible-machine/machine-background.webp"
            alt=""
            className={styles.backgroundLayer}
            draggable={false}
          />

          {/* Layer 2: Tabletop Mechanism Chassis Base */}
          <img
            src="/assets/first-ten/impossible-machine/machine-chassis.webp"
            alt=""
            className={styles.chassisLayer}
            draggable={false}
          />

          {/* Layer 3: Physical Railway Tracks, Rotating Junctions, Rotors, Key Station & Carriage */}
          <MachineRailway
            state={state}
            carriagePos={carriagePos}
            carriageCarryingKey={state.keyRetrieved}
            carriageBumped={carriageBumped}
            onRotateWest={() =>
              setState(prev => reduceMachineState(prev, { type: "ROTATE_WEST_JUNCTION" }))
            }
            onRotateEast={() =>
              setState(prev => reduceMachineState(prev, { type: "ROTATE_EAST_JUNCTION" }))
            }
            onToggleUpperRotor={() =>
              setState(prev => reduceMachineState(prev, { type: "TOGGLE_UPPER_ROTOR" }))
            }
            onToggleLowerRotor={() =>
              setState(prev => reduceMachineState(prev, { type: "TOGGLE_LOWER_ROTOR" }))
            }
            onExamineCenter={handleExamineCenter}
            hasOpportunity={Boolean(adapter.opportunity)}
          />

          {/* Layer 4: Rook Character + Independent Glass Dome Overlay + Lock */}
          <MachineRook state={state} unlockStage={unlockStage} />
        </div>

        {/* Layer 5: Physical THEN/NOW Dial & Brass Wind-Up Crank */}
        <MachineControls
          dial={state.dial}
          crankSpinning={crankSpinning}
          disabled={traveling || state.domeUnlocked}
          routeConnected={routeEval.connected}
          onToggleDial={() =>
            setState(prev => reduceMachineState(prev, { type: "SET_DIAL" }))
          }
          onWindCrank={handleWindCrank}
        />
      </div>

      {/* Quick Action Bar below the machine for accessibility & inspecting the center note */}
      <div className={styles.QuickActionStrip}>
        {adapter.opportunity && !state.domeUnlocked ? (
          <button
            type="button"
            className={styles.inspectNoteQuickBtn}
            onClick={() => {
              if (!correspondenceOpen) handleExamineCenter();
              else setCorrespondenceOpen(false);
            }}
            data-testid="machine-toggle-correspondence"
          >
            {correspondenceOpen
              ? "Hide Center Correspondence"
              : `Inspect Center Note (${adapter.opportunity.firstName ?? adapter.opportunity.person.name ?? adapter.opportunity.person.address})`}
          </button>
        ) : null}

        {state.lastAttempt && !state.lastAttempt.connected ? (
          <p className={styles.haltFeedbackNote} role="status" data-testid="machine-halt-feedback">
            {state.lastAttempt.stopReason === "upper_return_gate_closed"
              ? "The upper THEN gate locked behind the carriage. Switch to NOW and use the lower rotor (or restore the center crossing)."
              : state.lastAttempt.stopReason === "center_crossing_broken"
                ? "The central crossing is uncoupled. Only a verified sent reply couples the center bridge — otherwise align the lower NOW route."
                : state.lastAttempt.stopReason === "upper_dial_requires_then"
                  ? "The upper railway requires the dial set to THEN."
                  : state.lastAttempt.stopReason === "lower_dial_requires_now"
                    ? "The lower railway requires the dial set to NOW."
                    : "The rails aren't continuous yet — rotate the junctions and rotor until the track aligns."}
          </p>
        ) : null}
      </div>

      {/* Integrated Center Correspondence Drawer */}
      <MachineCorrespondence
        open={correspondenceOpen}
        example={adapter.example}
        dial={state.dial}
        opportunity={adapter.opportunity}
        draft={adapter.draft}
        activation={adapter.activation}
        correspondenceChoice={state.correspondenceChoice}
        centerBridgeRestored={state.centerBridgeRestored}
        checkoutNotice={adapter.checkoutNotice}
        connectNotice={adapter.connectNotice}
        onToggleDial={() => setState(prev => reduceMachineState(prev, { type: "SET_DIAL" }))}
        onChoose={handleCorrespondenceChoice}
        onChangeDraft={async change => {
          await adapter.onChangeDraft(change);
        }}
        onBeginActivation={adapter.onBeginActivation}
        onBringYourOwn={adapter.onBringYourOwn}
        onSendDraft={adapter.onSendDraft}
        onAllowSend={adapter.onAllowSend}
        onVerifyDraft={adapter.onVerifyDraft}
        onClose={() => setCorrespondenceOpen(false)}
      />

      {/* State I: Rescue & Comedic Theft Ending (also surfaces ClosingBeat when draft has a sent/declined outcome) */}
      <MachineEnding
        state={state}
        draftStatus={adapter.draft?.status ?? null}
        onContinueToPage={adapter.onFinishAdventure ? () => void adapter.onFinishAdventure!() : undefined}
      />

      {/* Paid Workspace Key & Back to Page link when a draft has been prepared */}
      {children}
      {adapter.draft && !state.domeUnlocked && adapter.onFinishAdventure ? (
        <div className={styles.backToPageRow}>
          <button
            type="button"
            className={styles.continueJoystickBtn}
            onClick={() => void adapter.onFinishAdventure!()}
            data-testid="first-ten-back-to-page"
          >
            Back to your page
          </button>
        </div>
      ) : null}
    </section>
  );
}
