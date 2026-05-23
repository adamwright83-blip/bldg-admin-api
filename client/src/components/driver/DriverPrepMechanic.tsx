import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  RotateCw,
  Radio,
  ChevronRight,
  Home,
} from "lucide-react";
import type { Order } from "@shared/types";
import { matchBuilding } from "@shared/buildings";
import {
  driverPrepReducer,
  getMissionDayKey,
  type DriverPrepState,
  type DriverPrepAction,
  type DriverPrepPhase,
} from "./driverPrepMachine";
import {
  hydrateDriverPrepState,
  persistDriverPrepState,
} from "./driverMissionStorage";
import {
  buildDriverMissionStops,
  deriveMissionTarget,
  type MissionTarget,
} from "./driverMissionModel";
import type {
  GameMissionTarget,
  GameOrder,
  GameStateSnapshot,
} from "./driverGameTypes";
import { sounds } from "./driverSounds";
import { haptics } from "./driverHaptics";
import CommandCenter from "./CommandCenter";
import OrderDetail from "./OrderDetail";
import AssetVerification from "./AssetVerification";
import LaundryRun from "./LaundryRun";
import MissionBriefing from "./MissionBriefing";
import FlyerProofCapture from "./FlyerProofCapture";
import SignalOverride from "./SignalOverride";
import MissionDebrief from "./MissionDebrief";

type Props = {
  pickups?: Order[];
  deliveries?: Order[];
  selectedDate: string;
  onSelectedDateChange: (date: string) => void;
  isLoading?: boolean;
  onOrderCreated?: () => Promise<void> | void;
  onResolveOrder: (
    orderId: number,
    nextStatus: "collected" | "delivered"
  ) => Promise<void>;
};

const OVERRIDE_TIMEOUT_MS = 8000;
const NEXT_TARGET_CINEMATIC_MS = 2200;
const SKIPPABLE_GAME_PHASES: ReadonlySet<DriverPrepPhase> =
  new Set<DriverPrepPhase>([
    "prep_t1",
    "prep_t2",
    "prep_t3",
    "prep_complete",
    "laundry_run",
    "mission_briefing",
    "flyer_proof",
    "signal_override",
    "verify_failed",
  ]);

/** Map the in-flight payload index → XP award tier. */
function xpForPayload(payloadIndex: number, payloadCount: number): number {
  if (payloadIndex >= payloadCount) return 100;
  if (payloadIndex >= Math.ceil(payloadCount / 2)) return 75;
  return 50;
}

function orderTypeFromStatus(status: Order["status"]): GameOrder["type"] {
  if (status === "ready") return "DELIVERY";
  return "PICKUP";
}

function nextStatusForOrder(
  status: Order["status"]
): "collected" | "delivered" {
  return status === "ready" ? "delivered" : "collected";
}

function formatPickupDate(dateStr: string): string {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function computeDeliveryDate(pickupDate: string): string {
  const [y, m, d] = pickupDate.split("-").map(Number);
  const next = new Date(y, m - 1, d + 1);
  return [
    next.getFullYear(),
    String(next.getMonth() + 1).padStart(2, "0"),
    String(next.getDate()).padStart(2, "0"),
  ].join("-");
}

function orderToGameOrder(order: Order): GameOrder {
  const isDelivery = order.status === "ready";
  const building = matchBuilding(order.address);
  return {
    id: order.id,
    type: isDelivery ? "DELIVERY" : "PICKUP",
    customerName: `${order.firstName} ${order.lastName}`.trim() || "Resident",
    address: order.address,
    items: Math.max(1, order.bagCount || 1),
    timeWindow: order.pickupTimeWindow || "—",
    nextStatus: nextStatusForOrder(order.status),
    unit: order.unit ?? null,
    buildingName: building?.name ?? null,
    dateLabel: isDelivery
      ? formatPickupDate(computeDeliveryDate(order.pickupDate))
      : formatPickupDate(order.pickupDate),
  };
}

function missionTargetToGameMission(
  target: MissionTarget,
  payloadIndex: number,
  payloadCount: number
): GameMissionTarget {
  return {
    label: target.label,
    address: target.address,
    mapsUrl: target.mapsUrl,
    intel: target.intel,
    distance:
      target.kind === "real"
        ? "ON ROUTE · NEXT STOP"
        : "ZONE CORRIDOR · NEARBY",
    reward: xpForPayload(payloadIndex, payloadCount),
    kind: target.kind,
  };
}

function scansCompletedFromState(state: DriverPrepState): number {
  let n = 0;
  if (state.prepUploads.t1.status === "secured") n++;
  if (state.prepUploads.t2.status === "secured") n++;
  if (state.prepUploads.t3.status === "secured") n++;
  return n;
}

function gameSnapshotFromState(state: DriverPrepState): GameStateSnapshot {
  return {
    scansCompleted: scansCompletedFromState(state),
    laundryScore: state.laundryRunScore,
    overrideSuccess:
      state.verification.result === "pending"
        ? null
        : state.verification.result === "success",
    totalXP: state.history.totalXp,
    streak: state.history.streakDays,
    missionsCompleted: state.history.missionsCompletedLifetime,
    missionNumber: state.missionNumber,
    payloadCount: state.payloadCount,
    currentPayloadIndex: state.currentPayloadIndex,
    missionCompletedForDay: state.missionCompletedForDay,
  };
}

/** Resolve the currently-selected order (from state.currentOrderId) or null. */
function pickCurrentOrder(
  state: DriverPrepState,
  ordersById: Map<number, Order>
): GameOrder | null {
  if (state.currentOrderId == null) return null;
  const order = ordersById.get(state.currentOrderId);
  return order ? orderToGameOrder(order) : null;
}

export function DriverPrepMechanic({
  pickups,
  deliveries,
  selectedDate,
  onSelectedDateChange,
  isLoading,
  onOrderCreated,
  onResolveOrder,
}: Props) {
  const [state, dispatch] = useReducer(
    driverPrepReducer,
    undefined,
    hydrateDriverPrepState
  );

  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    persistDriverPrepState(state);
  }, [state]);

  useEffect(() => {
    const todayKey = getMissionDayKey();
    if (
      state.missionCompletedForDay &&
      state.history.lastCompletedDayKey &&
      state.history.lastCompletedDayKey !== todayKey &&
      state.missionDayKey !== todayKey
    ) {
      dispatch({ type: "ROLL_TO_NEXT_DAY", todayKey });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ordersById = useMemo(() => {
    const map = new Map<number, Order>();
    for (const o of pickups ?? []) map.set(o.id, o);
    for (const o of deliveries ?? []) map.set(o.id, o);
    return map;
  }, [pickups, deliveries]);

  const availableOrders = useMemo<GameOrder[]>(() => {
    const resolved = new Set(state.resolvedOrderIdsCurrentMission);
    const combined: Order[] = [...(pickups ?? []), ...(deliveries ?? [])];
    return combined
      .filter((o) => !resolved.has(o.id))
      .map(orderToGameOrder);
  }, [pickups, deliveries, state.resolvedOrderIdsCurrentMission]);

  const selectedOrder = useMemo(
    () => pickCurrentOrder(state, ordersById),
    [state, ordersById]
  );

  const missionStops = useMemo(
    () => buildDriverMissionStops(pickups, deliveries),
    [pickups, deliveries]
  );

  const missionTarget = useMemo<GameMissionTarget>(() => {
    const real = deriveMissionTarget(
      missionStops,
      state.resolvedOrderIdsCurrentMission,
      state.missionNumber,
      state.currentPayloadIndex
    );
    return missionTargetToGameMission(
      real,
      state.currentPayloadIndex,
      state.payloadCount
    );
  }, [
    missionStops,
    state.resolvedOrderIdsCurrentMission,
    state.missionNumber,
    state.currentPayloadIndex,
    state.payloadCount,
  ]);

  const snapshot = useMemo(() => gameSnapshotFromState(state), [state]);

  // Fire the real TRPC mutation whenever the reducer queues one.
  const resolveInFlightRef = useRef(false);
  useEffect(() => {
    const pending = state.pendingOrderResolution;
    if (!pending) return;
    if (resolveInFlightRef.current) return;
    resolveInFlightRef.current = true;
    (async () => {
      try {
        await onResolveOrder(pending.orderId, pending.nextStatus);
      } catch (err) {
        console.error("Driver order resolution failed", err);
      } finally {
        resolveInFlightRef.current = false;
        dispatch({ type: "ACK_ORDER_RESOLUTION" });
      }
    })();
  }, [state.pendingOrderResolution, onResolveOrder]);

  // Cinematic beat before rolling to the next payload.
  useEffect(() => {
    if (state.phase !== "next_target") return;
    const t = setTimeout(() => {
      dispatch({ type: "ADVANCE_WITHOUT_MAP" });
    }, NEXT_TARGET_CINEMATIC_MS);
    return () => clearTimeout(t);
  }, [state.phase]);

  // Auto-jump from prep_complete into laundry_run.
  useEffect(() => {
    if (state.phase !== "prep_complete") return;
    dispatch({ type: "ADVANCE_PREP_COMPLETE" });
  }, [state.phase]);

  const handleSelectOrder = useCallback((order: GameOrder) => {
    dispatch({ type: "SELECT_ORDER", orderId: order.id });
  }, []);

  const handleBackToCommand = useCallback(() => {
    dispatch({ type: "BACK_TO_COMMAND_CENTER" });
  }, []);

  const handleStartVerification = useCallback(() => {
    dispatch({ type: "START_RUN_FROM_ORDER" });
  }, []);

  const handleSkipGamesToCommand = useCallback(() => {
    sounds.scanConfirm();
    haptics.slam();
    dispatch({
      type: "SKIP_GAMES_TO_COMMAND_CENTER",
      resolvedOrder: selectedOrder
        ? { orderId: selectedOrder.id, nextStatus: selectedOrder.nextStatus }
        : undefined,
    });
  }, [selectedOrder]);

  const handleCompleteScan = useCallback(
    (tier: 1 | 2 | 3, previewDataUrl?: string | null) => {
      if (previewDataUrl) {
        dispatch({
          type: "SET_PREP_PREVIEW",
          tier,
          previewDataUrl,
        });
      }
      dispatch({
        type: "SECURE_PREP_TASK",
        tier,
        now: new Date().toISOString(),
      });
    },
    []
  );

  const handleCompleteLaundryRun = useCallback((score: number) => {
    dispatch({ type: "COMPLETE_LAUNDRY_RUN", score });
  }, []);

  const handleFlyerPosted = useCallback(() => {
    dispatch({ type: "ADVANCE_TO_FLYER_PROOF" });
  }, []);

  const handleCompleteFlyerProof = useCallback(
    (previewDataUrl?: string | null) => {
      const now = Date.now();
      const startedAt = new Date(now).toISOString();
      dispatch({
        type: "COMPLETE_FLYER_PROOF",
        previewDataUrl,
      });
      dispatch({
        type: "START_SIGNAL_OVERRIDE",
        startedAt,
        deadlineAt: new Date(now + OVERRIDE_TIMEOUT_MS).toISOString(),
      });
    },
    []
  );

  const handleOverrideComplete = useCallback(
    (success: boolean) => {
      if (success) {
        const order = selectedOrder;
        const xpAwarded = xpForPayload(
          state.currentPayloadIndex,
          state.payloadCount
        );
        const resolvedOrder =
          order != null
            ? { orderId: order.id, nextStatus: order.nextStatus }
            : undefined;
        const action: DriverPrepAction = {
          type: "RESOLVE_VERIFY_SUCCESS",
          now: new Date().toISOString(),
          xpAwarded,
          resolvedOrder,
        };
        dispatch(action);
      } else {
        dispatch({
          type: "RESOLVE_VERIFY_FAILURE",
          reason: "manual_test_failure",
          now: new Date().toISOString(),
        });
      }
    },
    [selectedOrder, state.currentPayloadIndex, state.payloadCount]
  );

  const handleDebriefReturn = useCallback(() => {
    if (state.phase === "mission_complete") {
      dispatch({ type: "BACK_TO_COMMAND_CENTER" });
    } else {
      dispatch({ type: "ADVANCE_AFTER_VERIFY_SUCCESS" });
    }
  }, [state.phase]);

  const handleRetryFailure = useCallback(() => {
    dispatch({ type: "ACK_VERIFY_FAILURE" });
  }, []);

  const scansCompleted = scansCompletedFromState(state);
  const showSkipButton =
    selectedOrder != null && SKIPPABLE_GAME_PHASES.has(state.phase);

  return (
    <div className="driver-game min-h-screen">
      {renderPhase(state.phase, {
        state: snapshot,
        rawState: state,
        orders: availableOrders,
        selectedDate,
        onSelectedDateChange,
        pickupCount: pickups?.length ?? 0,
        deliveryCount: deliveries?.length ?? 0,
        selectedOrder,
        missionTarget,
        scansCompleted,
        isLoading: Boolean(isLoading),
        handleSelectOrder,
        onOrderCreated,
        handleBackToCommand,
        handleStartVerification,
        handleSkipGamesToCommand,
        handleCompleteScan,
        handleCompleteLaundryRun,
        handleFlyerPosted,
        handleCompleteFlyerProof,
        handleOverrideComplete,
        handleDebriefReturn,
        handleRetryFailure,
      })}
      {showSkipButton ? (
        <button
          type="button"
          onClick={handleSkipGamesToCommand}
          disabled={Boolean(isLoading)}
          aria-label="Skip mini games and return to driver home"
          className="fixed right-4 top-4 z-[70] inline-flex items-center gap-2 border border-neon/50 bg-black/75 px-4 py-3 text-neon shadow-[0_0_18px_oklch(0.85_0.25_155/0.18)] backdrop-blur
                     transition-all active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none"
        >
          <Home className="w-4 h-4" />
          <span className="font-display text-[12px] font-extrabold uppercase tracking-[0.18em]">
            Skip
          </span>
        </button>
      ) : null}
    </div>
  );
}

type RenderArgs = {
  state: GameStateSnapshot;
  rawState: DriverPrepState;
  orders: GameOrder[];
  selectedDate: string;
  onSelectedDateChange: (date: string) => void;
  pickupCount: number;
  deliveryCount: number;
  selectedOrder: GameOrder | null;
  missionTarget: GameMissionTarget;
  scansCompleted: number;
  isLoading: boolean;
  handleSelectOrder: (order: GameOrder) => void;
  onOrderCreated?: () => Promise<void> | void;
  handleBackToCommand: () => void;
  handleStartVerification: () => void;
  handleSkipGamesToCommand: () => void;
  handleCompleteScan: (
    tier: 1 | 2 | 3,
    previewDataUrl?: string | null
  ) => void;
  handleCompleteLaundryRun: (score: number) => void;
  handleFlyerPosted: () => void;
  handleCompleteFlyerProof: (previewDataUrl?: string | null) => void;
  handleOverrideComplete: (success: boolean) => void;
  handleDebriefReturn: () => void;
  handleRetryFailure: () => void;
};

function renderPhase(phase: DriverPrepPhase, args: RenderArgs) {
  switch (phase) {
    case "command_center":
      return (
        <CommandCenter
          orders={args.orders}
          state={args.state}
          selectedDate={args.selectedDate}
          onSelectedDateChange={args.onSelectedDateChange}
          pickupCount={args.pickupCount}
          deliveryCount={args.deliveryCount}
          onSelectOrder={args.handleSelectOrder}
          onOrderCreated={args.onOrderCreated}
          isLoading={args.isLoading}
        />
      );
    case "order_detail":
      if (!args.selectedOrder) {
        return (
          <CommandCenter
            orders={args.orders}
            state={args.state}
            selectedDate={args.selectedDate}
            onSelectedDateChange={args.onSelectedDateChange}
            pickupCount={args.pickupCount}
            deliveryCount={args.deliveryCount}
            onSelectOrder={args.handleSelectOrder}
            onOrderCreated={args.onOrderCreated}
            isLoading={args.isLoading}
          />
        );
      }
      return (
        <OrderDetail
          order={args.selectedOrder}
          onStartVerification={args.handleStartVerification}
          onSkipGames={args.handleSkipGamesToCommand}
          onBack={args.handleBackToCommand}
        />
      );
    case "prep_t1":
    case "prep_t2":
    case "prep_t3":
    case "prep_complete":
      return (
        <AssetVerification
          scansCompleted={args.scansCompleted}
          onCompleteScan={args.handleCompleteScan}
        />
      );
    case "laundry_run":
      return <LaundryRun onComplete={args.handleCompleteLaundryRun} />;
    case "mission_briefing":
      return (
        <MissionBriefing
          mission={args.missionTarget}
          onFlyerPosted={args.handleFlyerPosted}
        />
      );
    case "flyer_proof":
      return (
        <FlyerProofCapture
          mission={args.missionTarget}
          onComplete={args.handleCompleteFlyerProof}
        />
      );
    case "signal_override":
      return <SignalOverride onComplete={args.handleOverrideComplete} />;
    case "verify_success":
      return (
        <MissionDebrief
          state={args.state}
          mission={args.missionTarget}
          onReturn={args.handleDebriefReturn}
          ctaLabel="Next Payload"
        />
      );
    case "verify_failed":
      return <VerifyFailedScreen onRetry={args.handleRetryFailure} />;
    case "next_target":
      return <NextPayloadTransition nextMission={args.missionTarget} />;
    case "mission_complete":
      return (
        <MissionDebrief
          state={args.state}
          mission={args.missionTarget}
          onReturn={args.handleDebriefReturn}
          ctaLabel="Return to Command Center"
        />
      );
    default:
      return (
        <div className="min-h-screen bg-black flex items-center justify-center">
          <p className="text-[10px] tracking-[0.5em] text-neon/60 uppercase font-semibold">
            Loading…
          </p>
        </div>
      );
  }
}

function VerifyFailedScreen({ onRetry }: { onRetry: () => void }) {
  useEffect(() => {
    sounds.overrideFail();
    haptics.error();
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-black relative overflow-hidden flex flex-col"
    >
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.06]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent, transparent 2px, oklch(0.65 0.28 25 / 0.25) 2px, oklch(0.65 0.28 25 / 0.25) 4px)",
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none animate-pulse-neon"
        style={{
          boxShadow:
            "inset 0 0 80px oklch(0.65 0.28 25 / 0.25), inset 0 0 160px oklch(0.65 0.28 25 / 0.08)",
        }}
      />

      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6">
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", damping: 12 }}
          className="mb-6"
        >
          <div className="w-16 h-16 border-2 border-danger/60 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-8 h-8 text-danger" />
          </div>
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="text-[9px] tracking-[0.5em] text-danger uppercase mb-3 font-semibold"
        >
          Override Failed
        </motion.p>

        <motion.h1
          initial={{ x: 0 }}
          animate={{ x: [0, -6, 6, -4, 4, 0] }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="font-display font-extrabold text-[36px] uppercase tracking-wider text-danger mb-4 text-center leading-none"
        >
          Payload Loop Reset
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="text-[11px] text-muted-foreground text-center max-w-[280px] leading-relaxed mb-10"
        >
          Signal lost. Restarting from payload 1. Prep remains secured — gear up
          and try the override again.
        </motion.p>

        <motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          onClick={() => {
            sounds.press();
            haptics.impact();
            onRetry();
          }}
          className="w-full max-w-xs border border-danger/50 hover:border-danger bg-danger/[0.04]
                     py-4 flex items-center justify-center gap-3
                     transition-all duration-200 active:bg-danger/10 group"
        >
          <RotateCw className="w-5 h-5 text-danger/80 group-hover:text-danger transition-colors" />
          <span className="font-display font-extrabold text-lg uppercase tracking-wider text-danger">
            Retry Payload
          </span>
        </motion.button>
      </div>
    </motion.div>
  );
}

function NextPayloadTransition({ nextMission }: { nextMission: GameMissionTarget }) {
  useEffect(() => {
    sounds.missionAssign();
    haptics.countdown();
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-black relative overflow-hidden flex items-center justify-center"
    >
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,136,0.2) 2px, rgba(0,255,136,0.2) 4px)",
        }}
      />

      <div className="relative z-10 text-center px-6">
        <motion.div
          initial={{ scale: 0, rotate: -90, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: "spring", damping: 12 }}
          className="mb-5 inline-flex"
        >
          <Radio className="w-10 h-10 text-neon glow-neon" />
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-[9px] tracking-[0.5em] text-neon/60 uppercase mb-3 font-semibold"
        >
          Incoming Transmission
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="font-display font-extrabold text-4xl uppercase tracking-wider text-foreground mb-3 leading-none"
        >
          Queueing Next Payload
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="text-[11px] text-muted-foreground tracking-wider max-w-[260px] mx-auto"
        >
          {nextMission.kind === "real"
            ? "Locking coordinates on next target"
            : "Scanning zone for nearest target"}
        </motion.p>

        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: "100%", opacity: 1 }}
          transition={{ delay: 0.8, duration: 1.2, ease: "easeOut" }}
          className="h-px bg-gradient-to-r from-transparent via-neon/60 to-transparent mt-6 mx-auto max-w-[220px]"
        />

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.1 }}
          className="flex items-center justify-center gap-1.5 mt-5 text-[10px] tracking-[0.3em] text-neon/70 uppercase font-semibold"
        >
          <span>Stand By</span>
          <ChevronRight className="w-3 h-3 animate-pulse-neon" />
        </motion.div>
      </div>
    </motion.div>
  );
}
