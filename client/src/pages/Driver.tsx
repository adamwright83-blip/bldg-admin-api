import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { LoginForm } from "@/components/LoginForm";
import { Loader2 } from "lucide-react";
import { DriverPrepMechanic } from "@/components/driver/DriverPrepMechanic";
import { ResidentFollowupAlert } from "@/components/admin/ResidentFollowupAlert";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { WalkInCapture } from "@/components/dayforge/WalkInCapture";
import GoldlineHome from "./goldline/GoldlineHome";
import "./goldline/goldline-legibility.css";
import "./goldline/goldline-live-fix.css";

function getLocalYmd(date = new Date()): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export default function Driver() {
  const { loading: authLoading, isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const [selectedDate, setSelectedDate] = useState(() => getLocalYmd());
  const [walkInOpen, setWalkInOpen] = useState(false);
  const completeCalendar = trpc.system.voiceWalkIn.calendarComplete.useMutation();

  useEffect(() => {
    if (!isAuthenticated) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const oauthError = params.get("error");
    if (oauthError) {
      toast.error(`Google Calendar connection was not completed: ${oauthError}`);
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
    if (!code || !state) return;
    void completeCalendar.mutateAsync({ code, state }).then(async result => {
      window.history.replaceState({}, "", window.location.pathname);
      await utils.system.voiceWalkIn.calendarStatus.invalidate();
      toast.success(result.connectedEmail ? `Google Calendar connected: ${result.connectedEmail}` : "Google Calendar connected.");
      setWalkInOpen(true);
    }).catch(error => {
      window.history.replaceState({}, "", window.location.pathname);
      toast.error(error instanceof Error ? error.message : "Could not finish Google Calendar connection.");
    });
  }, [isAuthenticated]);

  const pickupQuery = trpc.admin.listByDate.useQuery({
    date: selectedDate,
    status: "new",
    dateField: "pickupDate",
  });
  const deliveryQuery = trpc.admin.listByDate.useQuery({
    date: selectedDate,
    status: "ready",
    dateField: "deliveryDate",
  });
  const updateStatus = trpc.admin.updateStatus.useMutation();
  const dispatches = trpc.system.commercialMission.myDispatches.useQuery(undefined, { enabled: isAuthenticated, refetchInterval: 15_000 });
  const builtMissions = trpc.system.commercialMission.myBuiltMissions.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 15_000,
  });
  const openDispatch = trpc.system.commercialMission.openDispatch.useMutation();
  const activeDispatch = dispatches.data?.find(item => item.channel === "in_app" && ["queued", "sent"].includes(item.status));

  async function invalidateLiveStatuses() {
    await Promise.all([
      utils.admin.listByStatus.invalidate({ status: "new" }),
      utils.admin.listByStatus.invalidate({ status: "collected" }),
      utils.admin.listByStatus.invalidate({ status: "ready" }),
      utils.admin.listByStatus.invalidate({ status: "delivered" }),
      utils.admin.dashboardSummary.invalidate(),
    ]);
  }

  const handleResolveOrder = async (
    orderId: number,
    status: "collected" | "delivered"
  ) => {
    if (status === "delivered") {
      const order = deliveryQuery.data?.find((row) => row.id === orderId);
      if (order && !order.paid) {
        toast.error("Charge the order before marking it delivered.");
        return;
      }
    }

    try {
      await updateStatus.mutateAsync({ orderId, status });
      await Promise.all([pickupQuery.refetch(), deliveryQuery.refetch(), invalidateLiveStatuses()]);
    } catch (error: any) {
      toast.error(error?.message || "Could not update order.");
    }
  };

  const handleOrderCreated = async () => {
    await Promise.all([pickupQuery.refetch(), deliveryQuery.refetch()]);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="animate-spin w-8 h-8 text-black/30" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginForm role="driver" onSuccess={() => window.location.reload()} />;
  }

  // Goldline is the new authenticated driver home. The previous operational
  // experience remains archived under client/src/archive/driver-2026-08-08.
  if (isAuthenticated) {
    return (
      <GoldlineHome
        pickups={pickupQuery.data}
        deliveries={deliveryQuery.data?.filter(order => order.paid)}
        salesMissions={builtMissions.data}
        selectedDate={selectedDate}
        onSelectedDateChange={setSelectedDate}
        isLoading={pickupQuery.isLoading || deliveryQuery.isLoading || builtMissions.isLoading}
      />
    );
  }

  return (
    <>
      {/* Drop-everything resident message alarm — flashing red, top of the driver screen. */}
      <ResidentFollowupAlert />
      {activeDispatch ? <button type="button" onClick={async () => {
        await openDispatch.mutateAsync({ dispatchId: activeDispatch.id });
        window.location.assign(activeDispatch.destinationPath);
      }} className="fixed inset-x-3 top-3 z-[60] rounded-2xl border-2 border-orange-300 bg-orange-500 p-5 text-left text-white shadow-2xl motion-safe:animate-pulse">
        <small className="font-black tracking-[.2em]">IRL MISSION · {new Date(activeDispatch.queuedAt).toLocaleTimeString()}</small>
        <strong className="mt-1 block text-xl">MISSION #{activeDispatch.missionId} READY</strong>
        <span className="mt-2 block text-sm font-black">TAP TO BEGIN →</span>
      </button> : null}
      <DriverPrepMechanic
        pickups={pickupQuery.data}
        deliveries={deliveryQuery.data?.filter((order) => order.paid)}
        salesMissions={builtMissions.data}
        selectedDate={selectedDate}
        onSelectedDateChange={setSelectedDate}
        isLoading={
          pickupQuery.isLoading ||
          deliveryQuery.isLoading ||
          updateStatus.isPending
        }
        onOrderCreated={handleOrderCreated}
        onResolveOrder={handleResolveOrder}
        onLogWalkIn={() => setWalkInOpen(true)}
      />
      <WalkInCapture
        open={walkInOpen}
        onClose={() => setWalkInOpen(false)}
        onSaved={result => {
          setWalkInOpen(false);
          void utils.system.adaptiveSalesMeter.myMeter.invalidate();
          const calendarText = result.calendar?.status === "created" || result.calendar?.status === "already_exists"
            ? " Google Calendar reminder added."
            : "";
          toast.success(`Walk-in ${result.missionCode} saved.${calendarText}`);
        }}
      />
    </>
  );
}
