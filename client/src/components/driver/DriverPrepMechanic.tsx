import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { Order } from "@shared/types";
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
import CommandCenter from "./CommandCenter";
import OrderDetail from "./OrderDetail";
import AssetVerification from "./AssetVerification";
import LaundryRun from "./LaundryRun";
import MissionBriefing from "./MissionBriefing";
import SignalOverride from "./SignalOverride";
import MissionDebrief from "./MissionDebrief";

type Props = {
  pickups?: Order[];
  deliveries?: Order[];
  isLoading?: boolean;
  onResolveOrder: (
    orderId: number,
    nextStatus: "collected" | "delivered"
  ) => Promise<void>;
};

const OVERRIDE_TIMEOUT_MS = 8000;
const VERIFY_FAILED_AUTO_ACK_MS = 2400;

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
  return {
    id: order.id,
    type: isDelivery ? "DELIVERY" : "PICKUP",
    customerName: `${order.firstName} ${order.lastName}`.trim() || "Resident",
    address: order.address,
    items: Math.max(1, order.bagCount || 1),
    timeWindow: order.pickupTimeWindow || "—",
    nextStatus: nextStatusForOrder(order.status),
    unit: order.unit ?? null,
    buildingName: null,
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
    distance: target.kind === "real" ? "≤ 0.5 mi" : "—",
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
  isLoading,
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

  // Auto-ack the verify_failed screen back into laundry_run after a beat.
  useEffect(() => {
    if (state.phase !== "verify_failed") return;
    const t = setTimeout(() => {
      dispatch({ type: "ACK_VERIFY_FAILURE" });
    }, VERIFY_FAILED_AUTO_ACK_MS);
    return () => clearTimeout(t);
  }, [state.phase]);

  // Auto-advance the "next_target" transitional phase back into laundry_run.
  useEffect(() => {
    if (state.phase !== "next_target") return;
    dispatch({ type: "ADVANCE_WITHOUT_MAP" });
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

  const handleStartOverride = useCallback(() => {
    const now = Date.now();
    dispatch({
      type: "START_SIGNAL_OVERRIDE",
      startedAt: new Date(now).toISOString(),
      deadlineAt: new Date(now + OVERRIDE_TIMEOUT_MS).toISOString(),
    });
  }, []);

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

  const scansCompleted = scansCompletedFromState(state);

  return (
    <div className="driver-game min-h-screen">
      {renderPhase(state.phase, {
        state: snapshot,
        rawState: state,
        orders: availableOrders,
        selectedOrder,
        missionTarget,
        scansCompleted,
        isLoading: Boolean(isLoading),
        handleSelectOrder,
        handleBackToCommand,
        handleStartVerification,
        handleCompleteScan,
        handleCompleteLaundryRun,
        handleStartOverride,
        handleOverrideComplete,
        handleDebriefReturn,
      })}
    </div>
  );
}

type RenderArgs = {
  state: GameStateSnapshot;
  rawState: DriverPrepState;
  orders: GameOrder[];
  selectedOrder: GameOrder | null;
  missionTarget: GameMissionTarget;
  scansCompleted: number;
  isLoading: boolean;
  handleSelectOrder: (order: GameOrder) => void;
  handleBackToCommand: () => void;
  handleStartVerification: () => void;
  handleCompleteScan: (
    tier: 1 | 2 | 3,
    previewDataUrl?: string | null
  ) => void;
  handleCompleteLaundryRun: (score: number) => void;
  handleStartOverride: () => void;
  handleOverrideComplete: (success: boolean) => void;
  handleDebriefReturn: () => void;
};

function renderPhase(phase: DriverPrepPhase, args: RenderArgs) {
  switch (phase) {
    case "command_center":
      return (
        <CommandCenter
          orders={args.orders}
          state={args.state}
          onSelectOrder={args.handleSelectOrder}
          isLoading={args.isLoading}
        />
      );
    case "order_detail":
      if (!args.selectedOrder) {
        return (
          <CommandCenter
            orders={args.orders}
            state={args.state}
            onSelectOrder={args.handleSelectOrder}
            isLoading={args.isLoading}
          />
        );
      }
      return (
        <OrderDetail
          order={args.selectedOrder}
          onStartVerification={args.handleStartVerification}
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
          onStartOverride={args.handleStartOverride}
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
      return <VerifyFailedScreen />;
    case "next_target":
      return <TransitionScreen label="Queueing Next Payload" />;
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
      return <TransitionScreen label="Loading" />;
  }
}

function VerifyFailedScreen() {
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6">
      <p className="text-[9px] tracking-[0.5em] text-danger uppercase mb-3 font-semibold">
        Override Failed
      </p>
      <p className="font-display font-extrabold text-[32px] uppercase tracking-wider text-danger mb-3 text-center">
        Payload Loop Reset
      </p>
      <p className="text-[11px] text-muted-foreground text-center max-w-[260px] leading-relaxed">
        Signal lost. Restarting from payload 1. Prep remains secured.
      </p>
    </div>
  );
}

function TransitionScreen({ label }: { label: string }) {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <p className="text-[10px] tracking-[0.5em] text-neon/60 uppercase font-semibold">
        {label}…
      </p>
    </div>
  );
}
