import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  Coins,
  Flame,
  MapPinned,
  ShieldCheck,
  Upload,
  UserCircle2,
} from "lucide-react";
import { toast } from "sonner";
import type { Order } from "@shared/types";
import { DriverMinesweeper } from "./DriverMinesweeper";
import { DriverProofUpload } from "./DriverProofUpload";
import { DriverVerificationCountdown } from "./DriverVerificationCountdown";
import {
  driverPrepReducer,
  getMissionDayKey,
  type DriverPrepPhase,
} from "./driverPrepMachine";
import {
  compressImageForMissionPreview,
  hydrateDriverPrepState,
  persistDriverPrepState,
} from "./driverMissionStorage";
import {
  buildDriverMissionStops,
  deriveMissionTarget,
} from "./driverMissionModel";
import "./driver-prep-mechanic.css";

type Props = {
  pickups?: Order[];
  deliveries?: Order[];
  isLoading?: boolean;
  onResolveOrder: (
    orderId: number,
    nextStatus: "collected" | "delivered"
  ) => Promise<void>;
};

type PickerMode = "prep_t1" | "prep_t2" | "prep_t3" | "deploy_live" | null;

function getRuntimeFlags() {
  if (typeof window === "undefined") {
    return {
      cheatMode: false,
      fastMode: false,
      manualVerifyFail: false,
      manualVerifyTimeout: false,
    };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    cheatMode: params.get("cheat") === "1",
    fastMode: params.get("fast") === "1",
    manualVerifyFail: params.get("verifyFail") === "1",
    manualVerifyTimeout: params.get("verifyTimeout") === "1",
  };
}

function getHudStatusLine(phase: DriverPrepPhase): string {
  switch (phase) {
    case "prep_t1":
    case "prep_t2":
    case "prep_t3":
      return "[GREEN] — STRIKE READINESS // CAR PREP IN PROGRESS";
    case "prep_complete":
      return "[GREEN] — STRIKE READINESS // CAR PREP COMPLETE // ASSETS SECURED";
    case "sweep_armed":
      return "[ARMED] — TARGET SWEEP // SELECT A LIVE CELL";
    case "sweep_resolved_safe":
      return "[GREEN] — MINE DIFFUSED // WINDOW SECURED";
    case "sweep_resolved_explosion":
      return "[RED] — DETONATION DETECTED // PAYLOAD LOOP RESET";
    case "deploy_live":
      return "[ARMED] — PAYLOAD DEPLOYMENT // PROOF REQUIRED";
    case "deploy_resolved":
      return "[GREEN] — PAYLOAD LOCKED // VERIFICATION READY";
    case "verify_countdown":
      return "[UNSTABLE] — VERIFICATION COUNTDOWN // HOLD STEADY";
    case "verify_success":
      return "[GREEN] — PAYLOAD VERIFIED // ROUTE PURITY RESTORED";
    case "verify_failed":
      return "[RED] — VERIFICATION FAILED // CORRECTIVE ACTION REQUIRED";
    case "next_target":
      return "[TARGET ACQUIRED] — SCANNING NEXT DEPLOYMENT WINDOW";
    case "mission_complete":
      return "[GREEN] — DAILY MISSION COMPLETE // ROUTE SECURED";
    default:
      return "[LIVE] — DRIVER PREP MECHANIC";
  }
}

function getHudStatusParts(phase: DriverPrepPhase): [string, string] {
  const [status, ...rest] = getHudStatusLine(phase).split(" — ");
  return [status ?? "[LIVE]", rest.join(" — ")];
}

function motionKey(phase: DriverPrepPhase, payloadIndex: number) {
  return `${phase}-${payloadIndex}`;
}

function getPhaseToneClass(phase: DriverPrepPhase): string {
  if (phase === "verify_countdown") return "is-countdown";
  if (
    phase === "sweep_resolved_explosion" ||
    phase === "verify_failed"
  ) {
    return "is-danger";
  }
  if (phase === "next_target") return "is-target";
  if (
    phase === "prep_complete" ||
    phase === "sweep_resolved_safe" ||
    phase === "verify_success" ||
    phase === "mission_complete"
  ) {
    return "is-success";
  }
  return "is-neutral";
}

export function DriverPrepMechanic({
  pickups,
  deliveries,
  isLoading,
  onResolveOrder,
}: Props) {
  const [state, dispatch] = useReducer(driverPrepReducer, undefined, hydrateDriverPrepState);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const persistToastShownRef = useRef(false);
  const mapDepartureSeenRef = useRef(false);
  const runtimeFlags = useMemo(() => getRuntimeFlags(), []);

  const stops = useMemo(
    () => buildDriverMissionStops(pickups, deliveries),
    [pickups, deliveries]
  );
  const missionTarget = useMemo(
    () =>
      deriveMissionTarget(
        stops,
        state.resolvedOrderIdsCurrentMission,
        state.missionNumber,
        state.currentPayloadIndex
      ),
    [
      state.currentPayloadIndex,
      state.missionNumber,
      state.resolvedOrderIdsCurrentMission,
      stops,
    ]
  );

  useEffect(() => {
    try {
      persistDriverPrepState(state);
      persistToastShownRef.current = false;
    } catch (error) {
      if (!persistToastShownRef.current) {
        persistToastShownRef.current = true;
        toast.warning("Current mission progress is live, but refresh restore may be limited on this device.");
      }
      console.warn("[DriverPrep] Failed to persist state:", error);
    }
  }, [state]);

  useEffect(() => {
    const checkForMissionDayAdvance = () => {
      const todayKey = getMissionDayKey();
      if (state.missionCompletedForDay && state.history.lastCompletedDayKey !== todayKey) {
        dispatch({ type: "ROLL_TO_NEXT_DAY", todayKey });
      }
    };

    checkForMissionDayAdvance();
    window.addEventListener("focus", checkForMissionDayAdvance);
    document.addEventListener("visibilitychange", checkForMissionDayAdvance);
    return () => {
      window.removeEventListener("focus", checkForMissionDayAdvance);
      document.removeEventListener("visibilitychange", checkForMissionDayAdvance);
    };
  }, [state.history.lastCompletedDayKey, state.missionCompletedForDay]);

  useEffect(() => {
    if (state.phase !== "sweep_resolved_safe") return;
    const timeoutId = window.setTimeout(
      () => dispatch({ type: "ADVANCE_AFTER_SAFE_HOLD" }),
      runtimeFlags.fastMode ? 420 : 900
    );
    return () => window.clearTimeout(timeoutId);
  }, [runtimeFlags.fastMode, state.phase]);

  useEffect(() => {
    if (state.phase !== "verify_success") return;
    const timeoutId = window.setTimeout(
      () => dispatch({ type: "ADVANCE_AFTER_VERIFY_SUCCESS" }),
      runtimeFlags.fastMode ? 500 : 950
    );
    return () => window.clearTimeout(timeoutId);
  }, [runtimeFlags.fastMode, state.phase]);

  useEffect(() => {
    if (state.phase !== "verify_countdown") return;
    const intervalId = window.setInterval(() => {
      setNowTick(Date.now());
    }, runtimeFlags.fastMode ? 60 : 110);
    return () => window.clearInterval(intervalId);
  }, [runtimeFlags.fastMode, state.phase]);

  useEffect(() => {
    if (state.phase !== "verify_countdown") return;
    if (!state.verification.startedAt || !state.verification.deadlineAt) return;

    const deadlineAt = new Date(state.verification.deadlineAt).getTime();
    if (nowTick < deadlineAt) return;

    const overtime = nowTick - deadlineAt;
    if (!state.deployment.previewDataUrl) {
      dispatch({
        type: "RESOLVE_VERIFY_FAILURE",
        reason: "missing_upload",
        now: new Date().toISOString(),
      });
      return;
    }

    if (runtimeFlags.manualVerifyTimeout || overtime > (runtimeFlags.fastMode ? 1500 : 3200)) {
      dispatch({
        type: "RESOLVE_VERIFY_FAILURE",
        reason: "timeout",
        now: new Date().toISOString(),
      });
      return;
    }

    if (runtimeFlags.manualVerifyFail) {
      dispatch({
        type: "RESOLVE_VERIFY_FAILURE",
        reason: "manual_test_failure",
        now: new Date().toISOString(),
      });
      return;
    }

    dispatch({
      type: "RESOLVE_VERIFY_SUCCESS",
      now: new Date().toISOString(),
      resolvedOrder:
        missionTarget.kind === "real" &&
        missionTarget.orderId &&
        missionTarget.nextStatus
          ? {
              orderId: missionTarget.orderId,
              nextStatus: missionTarget.nextStatus,
            }
          : undefined,
    });
  }, [
    missionTarget,
    nowTick,
    runtimeFlags.fastMode,
    runtimeFlags.manualVerifyFail,
    runtimeFlags.manualVerifyTimeout,
    state.deployment.previewDataUrl,
    state.phase,
    state.verification.deadlineAt,
    state.verification.startedAt,
  ]);

  useEffect(() => {
    if (!state.pendingOrderResolution) return;
    let canceled = false;

    const run = async () => {
      try {
        await onResolveOrder(
          state.pendingOrderResolution!.orderId,
          state.pendingOrderResolution!.nextStatus
        );
      } catch (error) {
        console.warn("[DriverPrep] Failed to resolve live order:", error);
        if (!canceled) {
          toast.error("Live driver queue sync failed. Mission progress stayed local.");
        }
      } finally {
        if (!canceled) dispatch({ type: "ACK_ORDER_RESOLUTION" });
      }
    };

    void run();
    return () => {
      canceled = true;
    };
  }, [onResolveOrder, state.pendingOrderResolution]);

  useEffect(() => {
    if (state.phase !== "next_target" || !state.nextTargetLaunchPending) return;

    const resume = () => {
      if (document.visibilityState === "hidden") {
        mapDepartureSeenRef.current = true;
        return;
      }

      if (document.visibilityState === "visible" && mapDepartureSeenRef.current) {
        mapDepartureSeenRef.current = false;
        dispatch({ type: "RESUME_AFTER_MAP_RETURN" });
      }
    };

    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [state.nextTargetLaunchPending, state.phase]);

  const countdownValue = useMemo(() => {
    if (state.phase !== "verify_countdown") return 3;
    if (!state.verification.startedAt || !state.verification.deadlineAt) return 3;
    const started = new Date(state.verification.startedAt).getTime();
    const deadline = new Date(state.verification.deadlineAt).getTime();
    const total = Math.max(1, deadline - started);
    const remaining = Math.max(0, deadline - nowTick);
    const segment = total / 3;
    return Math.max(1, Math.min(3, Math.ceil(remaining / segment)));
  }, [nowTick, state.phase, state.verification.deadlineAt, state.verification.startedAt]);

  const missionCounter = `MISSION ${String(state.missionNumber).padStart(2, "0")}/30`;
  const earnedDisplay = `${state.history.payloadsDiffusedLifetime * 250}`.replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ","
  );
  const [hudStatus, hudLine] = getHudStatusParts(state.phase);

  const handleFilePick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !pickerMode) return;

    try {
      const previewDataUrl = await compressImageForMissionPreview(file);
      const now = new Date().toISOString();
      if (pickerMode === "prep_t1") {
        dispatch({ type: "UPLOAD_PREP", tier: 1, previewDataUrl, now });
      } else if (pickerMode === "prep_t2") {
        dispatch({ type: "UPLOAD_PREP", tier: 2, previewDataUrl, now });
      } else if (pickerMode === "prep_t3") {
        dispatch({ type: "UPLOAD_PREP", tier: 3, previewDataUrl, now });
      } else if (pickerMode === "deploy_live") {
        dispatch({ type: "UPLOAD_DEPLOY_PROOF", previewDataUrl, now });
      }
    } catch (error) {
      console.warn("[DriverPrep] Failed to compress image:", error);
      toast.error("Image processing failed. Try another image.");
    } finally {
      setPickerMode(null);
    }
  };

  const openPicker = (mode: PickerMode) => {
    setPickerMode(mode);
    fileInputRef.current?.click();
  };

  const passPrepTask = (tier: 1 | 2 | 3) => {
    if (!runtimeFlags.cheatMode) return;
    dispatch({
      type: "UPLOAD_PREP",
      tier,
      previewDataUrl: "",
      now: new Date().toISOString(),
    });
  };

  const startVerification = () => {
    const startedAt = new Date().toISOString();
    const durationMs = runtimeFlags.fastMode ? 1800 : 3300;
    const deadlineAt = new Date(Date.now() + durationMs).toISOString();
    dispatch({ type: "START_VERIFY_COUNTDOWN", startedAt, deadlineAt });
  };

  const handleNextTargetCta = () => {
    if (missionTarget.kind === "real" && missionTarget.mapsUrl) {
      mapDepartureSeenRef.current = false;
      dispatch({ type: "REGISTER_NEXT_TARGET_LAUNCH" });
      const mapWindow = window.open(
        missionTarget.mapsUrl,
        "_blank",
        "noopener,noreferrer"
      );
      if (!mapWindow) {
        dispatch({ type: "CANCEL_NEXT_TARGET_LAUNCH" });
        toast.error("Unable to launch Maps. Allow pop-ups or try again.");
      }
      return;
    }

    dispatch({ type: "ADVANCE_WITHOUT_MAP" });
  };

  const phaseToneClass = getPhaseToneClass(state.phase);

  const checkStates = [
    state.prepUploads.t1.status === "uploaded",
    state.prepUploads.t2.status === "uploaded",
    state.prepUploads.t3.status === "uploaded",
  ];

  const surface = (() => {
    switch (state.phase) {
      case "prep_t1":
      case "prep_t2":
      case "prep_t3": {
        const tier = state.phase === "prep_t1" ? 1 : state.phase === "prep_t2" ? 2 : 3;
        const slot =
          tier === 1
            ? state.prepUploads.t1
            : tier === 2
              ? state.prepUploads.t2
              : state.prepUploads.t3;
        return (
          <div className="driver-prep-surface">
            <div className="driver-prep-headerBlock">
              <span className="driver-prep-phaseLabel">Strike Readiness</span>
              <h1 className="driver-prep-title">Prep T{tier}</h1>
              <p className="driver-prep-subtitle">
                Secure prep asset {tier} with hard visual proof. Only one live action surface remains on screen.
              </p>
            </div>
            <div className="driver-prep-checkRow">
              {["T1", "T2", "T3"].map((label, index) => (
                <div
                  key={label}
                  className={`driver-prep-checkChip ${checkStates[index] ? "is-complete" : ""}`}
                >
                  <Check size={16} />
                  {label}
                </div>
              ))}
            </div>
            <DriverProofUpload
              title={`Upload Prep Asset ${tier}`}
              subtitle="Flyer proof only. Lock the current prep tier before advancing."
              statusLabel={
                slot.status === "uploaded" ? "Asset secured" : "Awaiting proof image"
              }
              previewDataUrl={slot.previewDataUrl}
              actionLabel={`Upload Asset ${tier}`}
              onPick={() =>
                openPicker(
                  tier === 1 ? "prep_t1" : tier === 2 ? "prep_t2" : "prep_t3"
                )
              }
            />
            {runtimeFlags.cheatMode ? (
              <button
                type="button"
                className="driver-prep-secondaryAction"
                onClick={() => passPrepTask(tier)}
              >
                Pass Task
              </button>
            ) : null}
          </div>
        );
      }
      case "prep_complete":
        return (
          <div className="driver-prep-surface">
            <div className="driver-prep-headerBlock">
              <span className="driver-prep-phaseLabel">Readiness Locked</span>
              <h1 className="driver-prep-title is-success">Prep Complete</h1>
              <p className="driver-prep-subtitle">
                All prep assets are green. The mission begins now and prep will remain secured even if the payload loop collapses.
              </p>
            </div>
            <div className="driver-prep-phaseCard">
              <div className="driver-prep-checkRow">
                {["Asset 1 Secure", "Asset 2 Secure", "Asset 3 Secure"].map((label) => (
                  <div key={label} className="driver-prep-checkChip is-complete">
                    <Check size={16} />
                    {label}
                  </div>
                ))}
              </div>
            </div>
            <button
              type="button"
              className="driver-prep-actionBar"
              onClick={() => dispatch({ type: "ADVANCE_PREP_COMPLETE" })}
            >
              <ShieldCheck className="driver-prep-actionIcon" />
              Arm Sweep
            </button>
          </div>
        );
      case "sweep_armed":
        return (
          <div className="driver-prep-surface">
            <div className="driver-prep-headerBlock">
              <span className="driver-prep-phaseLabel">
                Payload {state.currentPayloadIndex}/{state.payloadCount}
              </span>
              <h1 className="driver-prep-title">Sweep Armed</h1>
              <p className="driver-prep-subtitle">
                Sweep one live square to clear the payload window. A mine hit resets this mission’s payload loop back to payload 1.
              </p>
            </div>
            <DriverMinesweeper
              sweep={state.sweep}
              disabled={isLoading}
              onSelectCell={(index) => dispatch({ type: "SELECT_SWEEP_CELL", index })}
            />
            <div className="driver-prep-counterRow">
              <span>Current target: {missionTarget.label}</span>
              <span>
                Payloads diffused: {state.completedPayloadsCurrentMission}/{state.payloadCount}
              </span>
            </div>
          </div>
        );
      case "sweep_resolved_safe":
        return (
          <div className="driver-prep-surface">
            <div className="driver-prep-headerBlock">
              <span className="driver-prep-phaseLabel">Mine Diffused</span>
              <h1 className="driver-prep-title is-success">Safe Window</h1>
            </div>
            <div className="driver-prep-centerDominant">
              <div className="driver-prep-winningCell">
                <span className="driver-prep-winningValue">
                  {(state.sweep.selectedIndex ?? 0) + 1}
                </span>
              </div>
            </div>
          </div>
        );
      case "sweep_resolved_explosion":
        return (
          <div className="driver-prep-surface">
            <div className="driver-prep-headerBlock">
              <span className="driver-prep-phaseLabel">Detonation Detected</span>
              <h1 className="driver-prep-title is-failure">Payload Loop Reset</h1>
              <p className="driver-prep-subtitle">
                Prep stays green. Mission number stays locked. Current mission payload progress drops back to payload 1.
              </p>
            </div>
            <div className="driver-prep-centerDominant">
              <div className="driver-prep-explosionPanel">
                <div className="driver-prep-explosionTile">X</div>
                <button
                  type="button"
                  className="driver-prep-actionBar"
                  onClick={() => dispatch({ type: "RESET_AFTER_EXPLOSION" })}
                >
                  <AlertTriangle className="driver-prep-actionIcon" />
                  Re-Arm Payload 1
                </button>
              </div>
            </div>
          </div>
        );
      case "deploy_live":
        return (
          <div className="driver-prep-surface">
            <div className="driver-prep-headerBlock">
              <span className="driver-prep-phaseLabel">
                Payload {state.currentPayloadIndex}/{state.payloadCount}
              </span>
              <h1 className="driver-prep-title">Deploy Live</h1>
              <p className="driver-prep-subtitle">
                Post the flyer, lock visual proof, then trigger verification. This surface replaces all routing UI by design.
              </p>
            </div>
            <DriverProofUpload
              title="Payload Proof"
              subtitle={`Target: ${missionTarget.label}`}
              statusLabel={
                state.deployment.status === "uploaded"
                  ? "Proof acquired"
                  : "Pending proof image"
              }
              previewDataUrl={state.deployment.previewDataUrl}
              actionLabel="Upload Proof Image"
              onPick={() => openPicker("deploy_live")}
            />
            <button
              type="button"
              className="driver-prep-actionBar"
              disabled={state.deployment.status !== "uploaded"}
              onClick={() => dispatch({ type: "LOCK_DEPLOY_PROOF" })}
            >
              <Upload className="driver-prep-actionIcon" />
              Lock Payload Proof
            </button>
          </div>
        );
      case "deploy_resolved":
        return (
          <div className="driver-prep-surface">
            <div className="driver-prep-headerBlock">
              <span className="driver-prep-phaseLabel">Proof Locked</span>
              <h1 className="driver-prep-title is-success">Deploy Resolved</h1>
              <p className="driver-prep-subtitle">
                Proof is secured. Verification will be deterministic: no random rejection, only real failure reasons.
              </p>
            </div>
            <DriverProofUpload
              title="Payload Secured"
              subtitle={`Target: ${missionTarget.label}`}
              statusLabel="Payload proof locked"
              previewDataUrl={state.deployment.previewDataUrl}
              actionLabel="Replace Proof Image"
              onPick={() => openPicker("deploy_live")}
            />
            <button
              type="button"
              className="driver-prep-actionBar"
              onClick={startVerification}
            >
              <ShieldCheck className="driver-prep-actionIcon" />
              Initiate Verification
            </button>
          </div>
        );
      case "verify_countdown":
        return (
          <div className="driver-prep-surface">
            <div className="driver-prep-headerBlock">
              <span className="driver-prep-phaseLabel">Verification</span>
              <h1 className="driver-prep-title">Countdown</h1>
            </div>
            <DriverVerificationCountdown value={countdownValue} />
          </div>
        );
      case "verify_success":
        return (
          <div className="driver-prep-surface">
            <div className="driver-prep-headerBlock">
              <span className="driver-prep-phaseLabel">Route Purity Restored</span>
              <h1 className="driver-prep-title is-success">Verify Success</h1>
            </div>
            <div className="driver-prep-statusBanner">
              <p className="driver-prep-proofTitle">
                SAFE — NO DETONATION DETECTED
              </p>
              <p className="driver-prep-subtitle">
                Payload secured. Route purity restored.
              </p>
            </div>
          </div>
        );
      case "verify_failed":
        return (
          <div className="driver-prep-surface">
            <div className="driver-prep-headerBlock">
              <span className="driver-prep-phaseLabel">Verification Failed</span>
              <h1 className="driver-prep-title is-failure">Corrective Action</h1>
              <p className="driver-prep-subtitle">
                {state.verification.failureReason === "timeout"
                  ? "Verification timed out before the lock could be confirmed."
                  : state.verification.failureReason === "missing_upload"
                    ? "Proof upload is missing. Verification cannot proceed."
                    : "Manual test failure forced this payload back into correction mode."}
              </p>
            </div>
            <div className="driver-prep-statusBanner is-failure">
              <p className="driver-prep-proofTitle">Verification Failed</p>
              <p className="driver-prep-subtitle">
                Failure reason: {state.verification.failureReason?.split("_").join(" ")}
              </p>
            </div>
            <button
              type="button"
              className="driver-prep-actionBar"
              onClick={() => dispatch({ type: "RETURN_TO_DEPLOY" })}
            >
              Retry Deployment
            </button>
          </div>
        );
      case "next_target":
        return (
          <div className="driver-prep-surface">
            <div className="driver-prep-headerBlock">
              <span className="driver-prep-phaseLabel">
                Next Payload {state.currentPayloadIndex}/{state.payloadCount}
              </span>
              <h1 className="driver-prep-title is-success">Target Acquired</h1>
              <p className="driver-prep-subtitle">
                Scanning nearby deployment zones and feeding live operational data into the next payload window.
              </p>
            </div>
            <div className="driver-prep-intelCard">
              <div className="driver-prep-intelMap">
                <div className="driver-prep-intelSweep" />
              </div>
              <div className="driver-prep-intelFooter">
                <span className="driver-prep-intelEyebrow">Operational Intel</span>
                <p className="driver-prep-targetTitle">{missionTarget.label}</p>
                <p className="driver-prep-intelText">{missionTarget.intel}</p>
                {missionTarget.customerName ? (
                  <p className="driver-prep-targetAddress">
                    Resident detected: {missionTarget.customerName}
                  </p>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              className="driver-prep-actionBar"
              onClick={handleNextTargetCta}
            >
              <MapPinned className="driver-prep-actionIcon" />
              {missionTarget.kind === "real" && missionTarget.address
                ? `Deploy To Next Target (${missionTarget.address})`
                : "Advance To Next Payload"}
            </button>
            {state.nextTargetLaunchPending ? (
              <>
                <div className="driver-prep-statusBanner">
                  <p className="driver-prep-proofTitle">Maps Link Live</p>
                  <p className="driver-prep-subtitle">
                    Navigation launched. Return to the app to arm the next payload, or resume manually if your browser stays in place.
                  </p>
                </div>
                <button
                  type="button"
                  className="driver-prep-secondaryAction"
                  onClick={() => dispatch({ type: "RESUME_AFTER_MAP_RETURN" })}
                >
                  Resume After Navigation
                </button>
              </>
            ) : null}
          </div>
        );
      case "mission_complete":
        return (
          <div className="driver-prep-surface">
            <div className="driver-prep-headerBlock">
              <span className="driver-prep-phaseLabel">Daily Completion</span>
              <h1 className="driver-prep-title is-success">
                Mission {state.missionNumber} Complete
              </h1>
              <p className="driver-prep-subtitle">
                Payloads {state.payloadCount}/{state.payloadCount} diffused. Route secured. Mission number advances on the next local day only.
              </p>
            </div>
            <div className="driver-prep-messagePanel">
              <p className="driver-prep-proofTitle">
                MISSION {state.missionNumber} COMPLETE
              </p>
              <p className="driver-prep-copy">
                PAYLOADS {state.payloadCount}/{state.payloadCount} DIFFUSED
                <br />
                ROUTE SECURED
              </p>
            </div>
          </div>
        );
      default:
        return (
          <div className="driver-prep-emptyState">
            <p className="driver-prep-emptyText">Driver prep mechanic is initializing.</p>
          </div>
        );
    }
  })();

  return (
    <div
      className={`driver-prep-overlay ${phaseToneClass}`}
      aria-label="Driver prep mechanic gameplay overlay"
    >
      <div className="driver-prep-backdrop" />
      <div className="driver-prep-shell">
        <div className="driver-prep-frame">
          <div className="driver-prep-hud">
            <div className="driver-prep-hudTop">
              <div className="driver-prep-hudCluster">
                <Flame className="driver-prep-hudFlame" />
                <div className="driver-prep-hudStat">
                  <span className="driver-prep-hudEyebrow">Fire Streak</span>
                  <span className="driver-prep-hudValue">
                    {state.completedPayloadsCurrentMission}/{state.payloadCount}
                  </span>
                </div>
                <Coins className="driver-prep-hudCoin" />
                <div className="driver-prep-hudStat">
                  <span className="driver-prep-hudEyebrow">Earned</span>
                  <span className="driver-prep-hudValue">{earnedDisplay} XP</span>
                </div>
              </div>

              <div className="driver-prep-hudRight">
                <div className="driver-prep-hudMission">
                  <span className="driver-prep-hudMissionLabel">Mission Box</span>
                  <span className="driver-prep-hudMissionValue">{missionCounter}</span>
                </div>
                {runtimeFlags.cheatMode ? (
                  <div className="driver-prep-hudCheat">CHEAT MODE</div>
                ) : null}
                <div className="driver-prep-hudAvatarWrap">
                  <UserCircle2 className="driver-prep-hudAvatar" />
                </div>
              </div>
            </div>

            <p className="driver-prep-hudTitle">
              <strong>{hudStatus}</strong>
              {" — "}
              {hudLine}
            </p>
          </div>

          <div className="driver-prep-body">
            <AnimatePresence mode="wait">
              <motion.div
                key={motionKey(state.phase, state.currentPayloadIndex)}
                initial={{ opacity: 0, y: 18, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -16, scale: 0.985 }}
                transition={{ duration: runtimeFlags.fastMode ? 0.16 : 0.26, ease: "easeOut" }}
                className="driver-prep-surface"
              >
                {surface}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={handleFilePick}
      />
    </div>
  );
}
