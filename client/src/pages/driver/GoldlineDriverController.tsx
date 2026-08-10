import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
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

export default function GoldlineDriverController() {
  const utils = trpc.useUtils();
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
  const driverGameWorld = trpc.system.driverGameWorld.current.useQuery(
    undefined,
    { refetchInterval: 15_000, retry: false }
  );
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

  const updateStatus = trpc.admin.updateStatus.useMutation();
  const acceptMove = trpc.system.field.acceptMove.useMutation();
  const openDispatch = trpc.system.commercialMission.openDispatch.useMutation();
  const resolveDay = trpc.system.unload.resolveDay.useMutation();
  const completeCalendar =
    trpc.system.voiceWalkIn.calendarComplete.useMutation();
  const generateOpenChannel =
    trpc.system.openChannel.generateDraft.useMutation();
  const approveOpenChannel = trpc.system.openChannel.approve.useMutation();
  const completeOpenChannelTask =
    trpc.system.openChannel.completeTask.useMutation();
  const beginRekindle =
    trpc.system.driverGameWorld.beginRekindle.useMutation();

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
      utils.system.openChannel.current.setData(
        openChannelInput,
        result.status === "completed" ? null : result
      );
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
        const others = (current ?? []).filter(item => item.missionId !== missionId);
        return [...others, node];
      });
      toast.success("Recovery path active. Real follow-up actions are inside the quest.");
      return node;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not begin Rekindle."
      );
      throw error;
    }
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
          worldNodes={driverGameWorld.data}
          isLoadingWorld={driverGameWorld.isLoading}
          isBeginningRekindle={beginRekindle.isPending}
          onBeginRekindle={handleBeginRekindle}
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
