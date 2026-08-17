import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { createGoldlineEventEmitter } from "../../game/analytics/emitGoldlineEvent";
import { QuickNewOrderSheet } from "@/components/driver/QuickNewOrderSheet";
import { SalesJournalSheet } from "@/components/driver/SalesMomentum";
import { WalkInCapture } from "@/components/dayforge/WalkInCapture";
import GoldlineHome from "../goldline/GoldlineHome";
import type { FieldMoveCandidate } from "../../../../server/field/types";
import type { DayResolution } from "../../../../server/unload/unloadTypes";
import type {
  GoldlineProgress,
  OpenChannelEditableTask,
} from "../../../../server/openChannel/openChannelTypes";
import type { OpenChannelGenerateInput } from "../goldline/OpenChannel";
import type {
  ColdCallBatch,
  ColdCallTarget,
} from "../../../../shared/coldCallBurst";
import type { RealActionRequest } from "../../game/encounters/RealActionBridge";
import type {
  GoldlineActionServices,
  GoldlineVisitContext,
} from "../../game/actions/actionServices";
import type { AuthoritativeFollowUp } from "../../game/actions/actionRegistry";
import {
  canCompleteDelivery,
  nextCommitmentDate,
  requestGoldlineLocation,
  type GoldlineLocationSnapshot,
} from "./goldlineDriverModel";

function getLocalYmd(date = new Date()): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

const REQUESTING_LOCATION: GoldlineLocationSnapshot = {
  status: "requesting",
  coordinates: null,
  accuracyMeters: null,
  reason: null,
};

const GoldlineGameHome = lazy(() => import("../../game/GoldlineGameHome"));
const GoldlineBusinessLoopHarness =
  import.meta.env.VITE_GOLDLINE_TEST_HARNESS === "1"
    ? lazy(() => import("../../game/testSupport/GoldlineBusinessLoopHarness"))
    : null;
const GoldlineProgressionHarness =
  import.meta.env.VITE_GOLDLINE_TEST_HARNESS === "1"
    ? lazy(() => import("../../game/testSupport/GoldlineProgressionHarness"))
    : null;
const GoldlineFictionHarness =
  import.meta.env.VITE_GOLDLINE_TEST_HARNESS === "1"
    ? lazy(() => import("../../game/testSupport/GoldlineFictionHarness"))
    : null;

export default function GoldlineDriverController() {
  const search = new URLSearchParams(window.location.search);
  if (GoldlineProgressionHarness && search.has("goldlineProgressionFixture")) {
    return (
      <Suspense fallback={null}>
        <GoldlineProgressionHarness />
      </Suspense>
    );
  }
  const fixture = search.get("goldlineFixture");
  if (GoldlineFictionHarness && fixture === "NEUTRALIZE") {
    return (
      <Suspense fallback={null}>
        <GoldlineFictionHarness />
      </Suspense>
    );
  }
  if (GoldlineBusinessLoopHarness && fixture) {
    return (
      <Suspense fallback={null}>
        <GoldlineBusinessLoopHarness fixture={fixture} />
      </Suspense>
    );
  }
  return <LiveGoldlineDriverController />;
}

function LiveGoldlineDriverController() {
  const utils = trpc.useUtils();
  /**
   * Scopes the local positional checkpoint to the signed-in player, so a
   * shared phone cannot hand one driver the previous driver's position in the
   * world. Carries no business state — see checkpointStorage.ts.
   */
  const identity = trpc.auth.me.useQuery();
  const [selectedDate, setSelectedDate] = useState(() => getLocalYmd());
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [dayResolution, setDayResolution] = useState<DayResolution | null>(
    null
  );
  const [location, setLocation] =
    useState<GoldlineLocationSnapshot>(REQUESTING_LOCATION);
  const oauthHandled = useRef(false);

  const pickupQueryInput = {
    date: selectedDate,
    status: "new" as const,
    dateField: "pickupDate" as const,
  };
  const deliveryQueryInput = {
    date: selectedDate,
    status: "ready" as const,
    dateField: "deliveryDate" as const,
  };
  const pickups = trpc.admin.listByDate.useQuery(pickupQueryInput);
  const deliveries = trpc.admin.listByDate.useQuery(deliveryQueryInput);

  /**
   * AUTHORITATIVE collected-order evidence.
   *
   * The four statuses that prove a pickup genuinely happened: `collected` is
   * the transition itself, and processing/ready/delivered are downstream of
   * it and unreachable without it. Read through the EXISTING
   * admin.listByStatus procedure — no migration, no new endpoint, no ledger.
   *
   * These are polled rather than merely invalidated on our own mutation
   * because the whole point is that this client is not the only way an order
   * becomes collected. A dispatcher marking it on the admin surface has to
   * reach the Stronghold here too.
   */
  const evidenceQueryOptions = { refetchInterval: 15_000 } as const;
  const collectedOrders = trpc.admin.listByStatus.useQuery(
    { status: "collected" },
    evidenceQueryOptions
  );
  const processingOrders = trpc.admin.listByStatus.useQuery(
    { status: "processing" },
    evidenceQueryOptions
  );
  const readyOrders = trpc.admin.listByStatus.useQuery(
    { status: "ready" },
    evidenceQueryOptions
  );
  const deliveredOrders = trpc.admin.listByStatus.useQuery(
    { status: "delivered" },
    evidenceQueryOptions
  );

  /**
   * ONE evidence collection: order id and status, nothing else. Deliberately
   * carries no customer, address, money or date — the Stronghold payoff is
   * derived from whether real pickups happened, and needs nothing more than
   * that to say so.
   */
  const collectedOrderEvidence = useMemo(
    () =>
      [
        ...(collectedOrders.data ?? []),
        ...(processingOrders.data ?? []),
        ...(readyOrders.data ?? []),
        ...(deliveredOrders.data ?? []),
      ].map(order => ({ id: order.id, status: order.status })),
    [
      collectedOrders.data,
      processingOrders.data,
      readyOrders.data,
      deliveredOrders.data,
    ]
  );
  const fieldToday = trpc.system.field.today.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const builtMissions = trpc.system.commercialMission.myBuiltMissions.useQuery(
    undefined,
    { refetchInterval: 15_000 }
  );
  const dispatches = trpc.system.commercialMission.myDispatches.useQuery(
    undefined,
    { refetchInterval: 15_000 }
  );
  const meter = trpc.system.adaptiveSalesMeter.myMeter.useQuery(undefined, {
    refetchInterval: 15_000,
  });
  const armory = trpc.system.armory.get.useQuery({});
  const strongholdIntel = trpc.system.armory.strongholdIntel.useQuery(
    undefined,
    { refetchInterval: 30_000, retry: false }
  );
  const driverGameWorld = trpc.system.driverGameWorld.current.useQuery(
    undefined,
    { refetchInterval: 15_000, retry: false }
  );
  const progression = trpc.system.driverGameWorld.progression.useQuery(
    undefined,
    { refetchInterval: 15_000, retry: false }
  );
  const coldCall = trpc.system.driverGameWorld.coldCall.useQuery(undefined, {
    refetchInterval: 15_000,
    retry: false,
  });
  const scoutReport = trpc.system.driverGameWorld.latestScoutReport.useQuery(
    undefined,
    {
      refetchInterval: 30_000,
      retry: false,
    }
  );
  const scoutCapability = trpc.system.driverGameWorld.scoutCapability.useQuery(
    undefined,
    { refetchInterval: 30_000, retry: false }
  );
  const followUpQueue = trpc.system.dayforgeToday.list.useQuery(undefined, {
    refetchInterval: 30_000,
    retry: false,
  });
  const openChannelInput = { businessDate: selectedDate };
  const progressInput = {
    businessDate: selectedDate,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  const openChannel = trpc.system.openChannel.current.useQuery(
    openChannelInput,
    {
      refetchInterval: 30_000,
    }
  );
  const goldlineProgress = trpc.system.openChannel.progress.useQuery(
    progressInput,
    { refetchInterval: 30_000 }
  );

  function advanceCachedProgress(kind: "pickup" | "delivery" | "mission") {
    utils.system.openChannel.progress.setData(progressInput, current => {
      if (!current) return current;
      const next: GoldlineProgress = {
        ...current,
        completedPickupCount:
          current.completedPickupCount + (kind === "pickup" ? 1 : 0),
        completedDeliveryCount:
          current.completedDeliveryCount + (kind === "delivery" ? 1 : 0),
        completedMissionStepCount:
          current.completedMissionStepCount + (kind === "mission" ? 1 : 0),
        completedRouteActions: current.completedRouteActions + 1,
        avatarSpace: current.avatarSpace + 1,
      };
      return next;
    });
  }

  const moveInput = useMemo(
    () => ({
      currentLocation:
        location.status === "available" ? location.coordinates : null,
      nextCommitmentAt: nextCommitmentDate(
        fieldToday.data?.nextFixedCommitment?.scheduledAt
      ),
    }),
    [fieldToday.data?.nextFixedCommitment?.scheduledAt, location]
  );
  const moves = trpc.system.field.moves.useQuery(moveInput, {
    enabled: location.status !== "requesting" && !fieldToday.isLoading,
    refetchInterval: 60_000,
  });
  const visitRoute = trpc.system.field.visitRoute.useQuery(undefined, {
    refetchInterval: 15_000,
    retry: false,
  });

  const updateStatus = trpc.admin.updateStatus.useMutation();
  const acceptMove = trpc.system.field.acceptMove.useMutation();
  const startVisitRoute = trpc.system.field.startVisitRoute.useMutation();
  const openDispatch = trpc.system.commercialMission.openDispatch.useMutation();
  const resolveDay = trpc.system.unload.resolveDay.useMutation();
  const completeCalendar =
    trpc.system.voiceWalkIn.calendarComplete.useMutation();
  const generateOpenChannel =
    trpc.system.openChannel.generateDraft.useMutation();
  const approveOpenChannel = trpc.system.openChannel.approve.useMutation();
  const completeOpenChannelTask =
    trpc.system.openChannel.completeTask.useMutation();
  const beginRekindle = trpc.system.driverGameWorld.beginRekindle.useMutation();
  const createColdCall =
    trpc.system.driverGameWorld.createColdCallBatch.useMutation();
  const startColdCall =
    trpc.system.driverGameWorld.startColdCallTarget.useMutation();
  const completeColdCall =
    trpc.system.driverGameWorld.completeColdCallTarget.useMutation();
  const selectColdCallChain =
    trpc.system.driverGameWorld.selectColdCallChainTarget.useMutation();
  const breakColdCallCombo =
    trpc.system.driverGameWorld.breakColdCallCombo.useMutation();
  const runScout = trpc.system.driverGameWorld.runScout.useMutation();
  const recordWeaponUsage = trpc.system.armory.recordUsage.useMutation();
  const logCallAttempt =
    trpc.system.commercialMission.logCallAttempt.useMutation();
  const startVisitPreparation =
    trpc.system.commercialMission.fieldStartPreparation.useMutation();
  const departVisit = trpc.system.commercialMission.fieldDepart.useMutation();
  const arriveVisit = trpc.system.commercialMission.fieldArrive.useMutation();
  const recordVisitOutcome =
    trpc.system.commercialMission.fieldOutcome.useMutation();
  const updateFieldChecklist =
    trpc.system.commercialMission.fieldChecklist.useMutation();
  const completeFollowUp =
    trpc.system.dayforgeToday.completeFollowUp.useMutation();
  const rescheduleFollowUp =
    trpc.system.dayforgeToday.rescheduleFollowUp.useMutation();
  const recordGoldlineEvent = trpc.system.goldlineEvents.record.useMutation();
  const emitGoldlineEvent = useMemo(
    () =>
      createGoldlineEventEmitter(input =>
        recordGoldlineEvent.mutateAsync(input)
      ),
    // recordGoldlineEvent.mutateAsync identity is stable across renders for a
    // given mutation hook instance; this only needs to be built once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const activeDispatch = dispatches.data?.find(
    item =>
      item.channel === "in_app" && ["queued", "sent"].includes(item.status)
  );

  useEffect(() => {
    let active = true;
    void requestGoldlineLocation(navigator.geolocation).then(result => {
      if (active) setLocation(result);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (oauthHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const oauthError = params.get("error");
    if (!oauthError && (!code || !state)) return;
    oauthHandled.current = true;
    if (oauthError) {
      toast.error(
        `Google Calendar connection was not completed: ${oauthError}`
      );
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
    void completeCalendar
      .mutateAsync({ code: code!, state: state! })
      .then(async result => {
        window.history.replaceState({}, "", window.location.pathname);
        await utils.system.voiceWalkIn.calendarStatus.invalidate();
        toast.success(
          result.connectedEmail
            ? `Google Calendar connected: ${result.connectedEmail}`
            : "Google Calendar connected."
        );
        setWalkInOpen(true);
      })
      .catch(error => {
        window.history.replaceState({}, "", window.location.pathname);
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not finish Google Calendar connection."
        );
      });
  }, [completeCalendar, utils]);

  async function invalidateDriverTruth() {
    await Promise.all([
      pickups.refetch(),
      deliveries.refetch(),
      fieldToday.refetch(),
      moves.refetch(),
      visitRoute.refetch(),
      builtMissions.refetch(),
      dispatches.refetch(),
      goldlineProgress.refetch(),
      utils.admin.listByStatus.invalidate({ status: "new" }),
      utils.admin.listByStatus.invalidate({ status: "collected" }),
      utils.admin.listByStatus.invalidate({ status: "ready" }),
      utils.admin.listByStatus.invalidate({ status: "delivered" }),
      utils.admin.dashboardSummary.invalidate(),
      utils.system.businessWorld.get.invalidate(),
      utils.system.driverGameWorld.current.invalidate(),
      utils.system.driverGameWorld.progression.invalidate(),
      utils.system.driverGameWorld.scoutCapability.invalidate(),
      utils.system.driverGameWorld.coldCall.invalidate(),
      utils.system.driverGameWorld.latestScoutReport.invalidate(),
    ]);
  }

  async function handleResolveOrder(
    orderId: number,
    status: "collected" | "delivered"
  ): Promise<boolean> {
    if (status === "delivered") {
      const order = deliveries.data?.find(row => row.id === orderId);
      if (!order || !canCompleteDelivery(order)) {
        toast.error(
          "Payment must be resolved before this delivery can finish."
        );
        return false;
      }
    }
    try {
      await updateStatus.mutateAsync({ orderId, status });
      advanceCachedProgress(status === "collected" ? "pickup" : "delivery");
      utils.admin.listByDate.setData(
        status === "collected" ? pickupQueryInput : deliveryQueryInput,
        rows => rows?.filter(order => order.id !== orderId)
      );
      void invalidateDriverTruth().catch(error => {
        console.warn("[Goldline] Background route refresh failed", error);
      });
      toast.success(
        status === "collected"
          ? "Pickup collected."
          : "Paid delivery completed."
      );
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update the order."
      );
      return false;
    }
  }

  async function resolveOrderAction(input: {
    orderId: number;
    status: "collected" | "delivered";
  }): Promise<boolean> {
    return handleResolveOrder(input.orderId, input.status);
  }

  async function handleAcceptMove(move: FieldMoveCandidate) {
    if (!move.missionId || !move.missionVersion) {
      toast.error("This sourced move is not activatable yet.");
      return;
    }
    try {
      await acceptMove.mutateAsync({
        moveId: move.id,
        missionId: move.missionId,
        expectedVersion: move.missionVersion,
        requestId: crypto.randomUUID(),
      });
      window.location.assign(move.destinationPath);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not activate this move."
      );
      await moves.refetch();
    }
  }

  async function handleStartVisitRoute(missionIds: number[]) {
    try {
      const route = await startVisitRoute.mutateAsync({
        requestId: crypto.randomUUID(),
        missionIds,
        ...moveInput,
      });
      utils.system.field.visitRoute.setData(undefined, route);
      toast.success(
        `Commercial visit route started: ${route.totalStops} stops.`
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not start the visit route."
      );
      await Promise.all([moves.refetch(), visitRoute.refetch()]);
    }
  }

  async function handleOpenDispatch() {
    if (!activeDispatch) return;
    try {
      await openDispatch.mutateAsync({ dispatchId: activeDispatch.id });
      window.location.assign(activeDispatch.destinationPath);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not open the dispatch."
      );
    }
  }

  async function handleResolveDay() {
    try {
      const result = await resolveDay.mutateAsync({
        businessDate: selectedDate,
        requestId: crypto.randomUUID(),
      });
      setDayResolution(result);
      await Promise.all([
        fieldToday.refetch(),
        meter.refetch(),
        armory.refetch(),
        strongholdIntel.refetch(),
        utils.system.businessWorld.get.invalidate(),
      ]);
      toast.success("The real business day is resolved.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not resolve the day."
      );
    }
  }

  async function handleOrderCreated() {
    await invalidateDriverTruth();
  }

  async function handleGenerateOpenChannel(input: OpenChannelGenerateInput) {
    try {
      const result = await generateOpenChannel.mutateAsync({
        businessDate: selectedDate,
        requestId: crypto.randomUUID(),
        now: new Date(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        nextCommitmentAt: nextCommitmentDate(input.nextCommitmentAt),
        availableMinutes: input.availableMinutes,
        currentLocation:
          location.status === "available" ? location.coordinates : null,
        transcript: input.transcript,
        audioDataUrl: input.audioDataUrl,
      });
      utils.system.openChannel.current.setData(openChannelInput, result);
      toast.success(
        "Open Channel draft received. Review it before deployment."
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Open Channel could not build the mission."
      );
    }
  }

  async function handleApproveOpenChannel(input: {
    missionId: string;
    title: string;
    tasks: OpenChannelEditableTask[];
  }) {
    try {
      const result = await approveOpenChannel.mutateAsync(input);
      utils.system.openChannel.current.setData(openChannelInput, result);
      toast.success(
        `${result.tasks.length} mission spaces loaded onto Goldline.`
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Open Channel mission could not be approved."
      );
    }
  }

  async function handleCompleteOpenChannelTask(
    missionId: string,
    taskId: string
  ): Promise<boolean> {
    try {
      const result = await completeOpenChannelTask.mutateAsync({
        missionId,
        taskId,
        requestId: crypto.randomUUID(),
      });
      advanceCachedProgress("mission");
      void goldlineProgress.refetch();
      // Preserve the canonical server response in the query cache even
      // when this was the final task. The expedition pins that task and must
      // be able to observe authoritative `status: completed` before showing
      // WORK SEALED. The normal polling query may later collapse a completed
      // mission to null after the expedition has reconciled; we do not erase
      // the evidence in the same tick as the canonical write.
      utils.system.openChannel.current.setData(openChannelInput, result);
      toast.success(
        result.status === "completed"
          ? "Open Channel mission complete."
          : "Mission space complete."
      );
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not complete this mission space."
      );
      return false;
    }
  }

  async function handleBeginRekindle(missionId: number) {
    try {
      const node = await beginRekindle.mutateAsync({
        missionId,
        requestId: crypto.randomUUID(),
      });
      utils.system.driverGameWorld.current.setData(undefined, current => {
        const others = (current ?? []).filter(
          item => item.missionId !== missionId
        );
        return [...others, node];
      });
      toast.success(
        "Recovery path active. Real follow-up actions are inside the quest."
      );
      return node;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not begin Rekindle."
      );
      throw error;
    }
  }

  function cacheColdCallBatch(batch: ColdCallBatch | null) {
    utils.system.driverGameWorld.coldCall.setData(undefined, current => ({
      batch,
      eligibleCount: current?.eligibleCount ?? 0,
      emptyReason: current?.emptyReason ?? null,
    }));
  }

  async function handleCreateColdCall() {
    const batch = await createColdCall.mutateAsync({
      requestId: crypto.randomUUID(),
    });
    cacheColdCallBatch(batch);
    if (!batch)
      toast.info(coldCall.data?.emptyReason ?? "No eligible call targets.");
    return batch;
  }

  async function handleStartColdCall(target: ColdCallTarget) {
    const batch = coldCall.data?.batch;
    if (!batch) throw new Error("Cold-call batch is unavailable");
    const next = await startColdCall.mutateAsync({
      batchId: batch.id,
      targetId: target.id,
    });
    if (!next) throw new Error("Cold-call batch is unavailable");
    cacheColdCallBatch(next);
    return next;
  }

  async function handleCompleteColdCall(input: {
    target: ColdCallTarget;
    outcome:
      | "no_answer"
      | "left_voicemail"
      | "spoke"
      | "visit_booked"
      | "not_a_fit"
      | "contact_unavailable";
    notes: string;
  }) {
    const batch = coldCall.data?.batch;
    if (!batch) throw new Error("Cold-call batch is unavailable");
    const next = await completeColdCall.mutateAsync({
      batchId: batch.id,
      targetId: input.target.id,
      requestId: crypto.randomUUID(),
      outcome: input.outcome,
      notes: input.notes,
    });
    if (!next) throw new Error("Cold-call batch is unavailable");
    cacheColdCallBatch(next);
    await Promise.all([
      builtMissions.refetch(),
      utils.system.commercialMission.callAttempts.invalidate({
        missionId: input.target.missionId,
      }),
    ]);
    return next;
  }

  async function handlePersistEncounterAction(input: RealActionRequest) {
    if (input.kind !== "CALL_ATTEMPT") {
      throw new Error(
        "This real action is not supported by the existing business service."
      );
    }
    await logCallAttempt.mutateAsync({
      missionId: input.missionId,
      requestId: input.requestId,
      outcome: input.outcome,
      notes: input.notes,
    });
    // Persistence completes first. Only then do we refetch every projection
    // that can change encounter resolution, world mutation, or next mission.
    await Promise.all([
      builtMissions.refetch(),
      driverGameWorld.refetch(),
      progression.refetch(),
      utils.system.commercialMission.callAttempts.invalidate({
        missionId: input.missionId,
      }),
    ]);
  }

  async function refetchGoldlineActionTruth(missionId: number | null) {
    await Promise.all([
      builtMissions.refetch(),
      driverGameWorld.refetch(),
      progression.refetch(),
      moves.refetch(),
      visitRoute.refetch(),
      followUpQueue.refetch(),
      missionId == null
        ? Promise.resolve()
        : utils.system.commercialMission.fieldState.invalidate({ missionId }),
      utils.system.driverGameWorld.latestScoutReport.invalidate(),
    ]);
  }

  async function loadVisitContext(
    missionId: number
  ): Promise<GoldlineVisitContext> {
    const state = await utils.system.commercialMission.fieldState.fetch({
      missionId,
    });
    if (!state) throw new Error("Authoritative visit state is unavailable");
    return state;
  }

  async function startVisitAction(input: {
    missionId: number;
    requestId: string;
  }): Promise<GoldlineVisitContext> {
    const current = await loadVisitContext(input.missionId);
    const next = await startVisitPreparation.mutateAsync({
      ...input,
      expectedMissionVersion: current.mission.version,
    });
    if (!next) throw new Error("Visit preparation was not persisted");
    return next;
  }

  async function departVisitAction(input: {
    missionId: number;
    requestId: string;
  }): Promise<GoldlineVisitContext> {
    const current = await loadVisitContext(input.missionId);
    if (!current.field)
      throw new Error("Field preparation is required before departure");
    const next = await departVisit.mutateAsync({
      ...input,
      expectedMissionVersion: current.mission.version,
      expectedFieldVersion: current.field.version,
    });
    if (!next) throw new Error("Departure was not persisted");
    return next;
  }

  async function arriveVisitAction(input: {
    missionId: number;
    requestId: string;
  }): Promise<GoldlineVisitContext> {
    const current = await loadVisitContext(input.missionId);
    if (!current.field)
      throw new Error("Departure must be recorded before arrival");
    const next = await arriveVisit.mutateAsync({
      ...input,
      expectedMissionVersion: current.mission.version,
      expectedFieldVersion: current.field.version,
      checkInMethod: "manual",
    });
    if (!next) throw new Error("Arrival was not persisted");
    return next;
  }

  async function updateChecklistItemAction(
    input: Parameters<GoldlineActionServices["updateChecklistItem"]>[0]
  ): Promise<GoldlineVisitContext> {
    const current = await loadVisitContext(input.missionId);
    if (!current.field)
      throw new Error("Field preparation is required before checklist items can change");
    const next = await updateFieldChecklist.mutateAsync({
      ...input,
      expectedFieldVersion: current.field.version,
    });
    if (!next) throw new Error("Checklist update was not persisted");
    return next;
  }

  async function recordVisitAction(
    input: Parameters<GoldlineActionServices["recordVisitOutcome"]>[0]
  ): Promise<GoldlineVisitContext> {
    const current = await loadVisitContext(input.missionId);
    if (!current.field) throw new Error("Arrival state is unavailable");
    const next = await recordVisitOutcome.mutateAsync({
      ...input,
      expectedMissionVersion: current.mission.version,
      expectedFieldVersion: current.field.version,
    });
    if (!next) throw new Error("Visit result was not persisted");
    return next;
  }

  async function loadAuthoritativeFollowUp(
    missionId: number
  ): Promise<AuthoritativeFollowUp | null> {
    const items = await utils.system.dayforgeToday.list.fetch();
    const item = items.find(
      candidate =>
        candidate.kind === "follow_up" &&
        candidate.missionId === missionId &&
        candidate.pipelineId != null &&
        candidate.followUpId != null &&
        candidate.dueAt != null
    );
    if (!item?.pipelineId || !item.followUpId || !item.dueAt) return null;
    const channel = item.phone
      ? "phone"
      : item.email
        ? "email"
        : item.address
          ? "in_person"
          : "unknown";
    return {
      pipelineId: item.pipelineId,
      followUpId: item.followUpId,
      dueAt: item.dueAt,
      note: item.note,
      channel,
    };
  }

  async function completeFollowUpAction(input: {
    followUp: AuthoritativeFollowUp;
    requestId: string;
  }) {
    await completeFollowUp.mutateAsync({
      pipelineId: input.followUp.pipelineId,
      followUpId: input.followUp.followUpId,
      requestId: input.requestId,
    });
  }

  async function rescheduleFollowUpAction(input: {
    followUp: AuthoritativeFollowUp;
    requestId: string;
    dueAt: Date;
  }) {
    await rescheduleFollowUp.mutateAsync({
      pipelineId: input.followUp.pipelineId,
      followUpId: input.followUp.followUpId,
      requestId: input.requestId,
      dueAt: input.dueAt,
    });
  }

  async function recoverAction(input: {
    missionId: number;
    requestId: string;
  }) {
    const node = await beginRekindle.mutateAsync(input);
    utils.system.driverGameWorld.current.setData(undefined, current => [
      ...(current ?? []).filter(item => item.missionId !== input.missionId),
      node,
    ]);
    return node;
  }

  async function scoutAction(input: { requestId: string }) {
    const report = await runScout.mutateAsync(input);
    utils.system.driverGameWorld.latestScoutReport.setData(undefined, report);
    return report;
  }

  const actionServices: GoldlineActionServices = {
    recordCall: handlePersistEncounterAction,
    loadVisit: loadVisitContext,
    startVisitPreparation: startVisitAction,
    updateChecklistItem: updateChecklistItemAction,
    departVisit: departVisitAction,
    arriveVisit: arriveVisitAction,
    recordVisitOutcome: recordVisitAction,
    loadFollowUp: loadAuthoritativeFollowUp,
    completeFollowUp: completeFollowUpAction,
    rescheduleFollowUp: rescheduleFollowUpAction,
    recover: recoverAction,
    scout: scoutAction,
    refetchAuthoritativeTruth: refetchGoldlineActionTruth,
    resolveOrder: resolveOrderAction,
  };

  async function handleSelectColdCallChain(target: ColdCallTarget) {
    const batch = coldCall.data?.batch;
    if (!batch) throw new Error("Cold-call batch is unavailable");
    const next = await selectColdCallChain.mutateAsync({
      batchId: batch.id,
      targetId: target.id,
    });
    if (!next) throw new Error("Cold-call batch is unavailable");
    cacheColdCallBatch(next);
    return next;
  }

  async function handleBreakColdCallCombo() {
    const batch = coldCall.data?.batch;
    if (!batch) throw new Error("Cold-call batch is unavailable");
    const next = await breakColdCallCombo.mutateAsync({ batchId: batch.id });
    if (!next) throw new Error("Cold-call batch is unavailable");
    cacheColdCallBatch(next);
    return next;
  }

  async function handleEvaluateScout() {
    const evaluation = await scoutCapability.refetch();
    if (evaluation.data?.unlocked)
      toast.success("Scout eligibility rebuilt from authoritative evidence.");
  }

  async function handleRunScout() {
    const report = await runScout.mutateAsync({
      requestId: crypto.randomUUID(),
    });
    utils.system.driverGameWorld.latestScoutReport.setData(undefined, report);
    await Promise.all([
      builtMissions.refetch(),
      moves.refetch(),
      driverGameWorld.refetch(),
      progression.refetch(),
      scoutCapability.refetch(),
    ]);
    toast.success(
      report.discoveries.length
        ? `${report.discoveries.length} sourced missions discovered.`
        : "Scout completed truthfully with 0 new opportunities."
    );
  }

  const currentDayProjection =
    fieldToday.data?.businessDate === selectedDate
      ? fieldToday.data
      : undefined;

  const gameHomeProps = {
    pickups: pickups.data,
    deliveries: deliveries.data,
    salesMissions: builtMissions.data,
    today: currentDayProjection,
    moves: moves.data,
    meter: meter.data,
    armory: armory.data,
    location,
    dayResolution,
    activeDispatch,
    openChannelMission: openChannel.data,
    goldlineProgress: goldlineProgress.data,
    selectedDate,
    onSelectedDateChange: setSelectedDate,
    isLoading:
      pickups.isLoading || deliveries.isLoading || builtMissions.isLoading,
    isResolvingOrder: updateStatus.isPending,
    isAcceptingMove: acceptMove.isPending,
    isResolvingDay: resolveDay.isPending,
    isGeneratingOpenChannel: generateOpenChannel.isPending,
    isApprovingOpenChannel: approveOpenChannel.isPending,
    isCompletingOpenChannelTask: completeOpenChannelTask.isPending,
    onResolveOrder: handleResolveOrder,
    onAcceptMove: handleAcceptMove,
    onOpenWalkIn: () => setWalkInOpen(true),
    onOpenNewOrder: () => setNewOrderOpen(true),
    onOpenJournal: () => setJournalOpen(true),
    onResolveDay: handleResolveDay,
    onOpenDispatch: activeDispatch ? handleOpenDispatch : undefined,
    onGenerateOpenChannel: handleGenerateOpenChannel,
    onApproveOpenChannel: handleApproveOpenChannel,
    onCompleteOpenChannelTask: handleCompleteOpenChannelTask,
  };

  return (
    <>
      <Suspense fallback={<GoldlineHome {...gameHomeProps} />}>
        <GoldlineGameHome
          {...gameHomeProps}
          playerIdentity={identity.data?.openId ?? null}
          worldNodes={driverGameWorld.data}
          progression={progression.data}
          driverSafeSalesIntel={
            strongholdIntel.isError ? null : (strongholdIntel.data ?? null)
          }
          isLoadingWorld={driverGameWorld.isLoading}
          isBeginningRekindle={beginRekindle.isPending}
          onBeginRekindle={handleBeginRekindle}
          coldCallBatch={coldCall.data?.batch}
          coldCallEligibleCount={coldCall.data?.eligibleCount ?? 0}
          coldCallEmptyReason={coldCall.data?.emptyReason}
          isCreatingColdCall={createColdCall.isPending}
          onCreateColdCall={handleCreateColdCall}
          onStartColdCall={handleStartColdCall}
          onCompleteColdCall={handleCompleteColdCall}
          onSelectColdCallChain={handleSelectColdCallChain}
          onBreakColdCallCombo={handleBreakColdCallCombo}
          scoutCapability={scoutCapability.data}
          isEvaluatingScout={scoutCapability.isFetching}
          onEvaluateScout={handleEvaluateScout}
          scoutReport={scoutReport.data}
          isRunningScout={runScout.isPending}
          onRunScout={handleRunScout}
          onRequestWeapons={input => utils.system.armory.weapons.fetch(input)}
          onRecordWeaponUsage={input => recordWeaponUsage.mutateAsync(input)}
          actionServices={actionServices}
          collectedOrderEvidence={collectedOrderEvidence}
          authoritativeVisitRoute={visitRoute.data}
          authoritativeRouteCoverage={visitRoute.data?.coveredCount ?? 0}
          isStartingVisitRoute={startVisitRoute.isPending}
          onStartVisitRoute={handleStartVisitRoute}
          onEmitEvent={emitGoldlineEvent}
        />
      </Suspense>
      <QuickNewOrderSheet
        open={newOrderOpen}
        onOpenChange={setNewOrderOpen}
        onOrderCreated={handleOrderCreated}
      />
      <WalkInCapture
        open={walkInOpen}
        onClose={() => setWalkInOpen(false)}
        onSaved={result => {
          setWalkInOpen(false);
          void Promise.all([
            utils.system.adaptiveSalesMeter.myMeter.invalidate(),
            utils.system.field.today.invalidate(),
            utils.system.field.moves.invalidate(),
            utils.system.armory.get.invalidate(),
            utils.system.commercialMission.myBuiltMissions.invalidate(),
            utils.system.commercialMission.myDispatches.invalidate(),
            utils.system.driverGameWorld.current.invalidate(),
          ]);
          const calendarText =
            result.calendar?.status === "created" ||
            result.calendar?.status === "already_exists"
              ? " Google Calendar reminder added."
              : "";
          toast.success(`Walk-in ${result.missionCode} saved.${calendarText}`);
        }}
      />
      <SalesJournalSheet open={journalOpen} onOpenChange={setJournalOpen} />
    </>
  );
}
