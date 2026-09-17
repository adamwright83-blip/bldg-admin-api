import { trpc } from "@/lib/trpc";
import { FirstMissionDriver } from "@/components/goldline/onboarding/FirstMissionDriver";
import { Loader2 } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { LoginForm } from "@/components/LoginForm";
import GoldlineDriverController from "./driver/GoldlineDriverController";
import GoldlineOverworld from "./goldline/GoldlineOverworld";
import { SalesJournalSheet } from "@/components/driver/SalesMomentum";
import { ClaireAnalysisInbox } from "@/components/goldline/ClaireAnalysisInbox";
import type { Order } from "@shared/types";
import "./goldline/goldline-legibility.css";
import "./goldline/goldline-live-fix.css";
import "./goldline/goldline-import-overlay.css";
import "./goldline/goldline-day-plan-concept.css";
import "./goldline/goldline-day-plan-p1-fixes.css";
import "./goldline/goldline-day-plan-p1-followup.css";
import "./goldline/goldline-driver-ui-polish.css";
import "./goldline/goldline-driver-ui-forced-mobile.css";
import "./goldline/goldline-driver-ui-contract.css";
import "./goldline/goldline-driver-light-surfaces.css";
import "./goldline/goldline-driver-cargo-light.css";
import "./goldline/goldline-driver-menu-reachability.css";

const WaywardTetheredDeck = lazy(
  () => import("./goldline/stages/WaywardTetheredDeck")
);
const ClockheadDuelFixture = import.meta.env.VITE_GOLDLINE_TEST_HARNESS === "1"
  ? lazy(() => import("./goldline/ClockheadDuel")) : null;
const GoldlineDayPlanFixture =
  import.meta.env.VITE_GOLDLINE_TEST_HARNESS === "1"
    ? lazy(() => import("./goldline/GoldlineDayPlanFixture"))
    : null;

export default function Driver() {
  if (ClockheadDuelFixture && new URLSearchParams(window.location.search).get("goldlineStageFixture") === "clockhead") {
    return <Suspense fallback={null}><ClockheadDuelFixture onDefeated={() => { window.location.href = "/driver?goldlineOverworldFixture=1"; }} /></Suspense>;
  }
  const overworldFixture =
    import.meta.env.VITE_GOLDLINE_TEST_HARNESS === "1" &&
    new URLSearchParams(window.location.search).has("goldlineOverworldFixture");
  const waywardFixture =
    import.meta.env.VITE_GOLDLINE_TEST_HARNESS === "1" &&
    new URLSearchParams(window.location.search).get("goldlineStageFixture") ===
      "wayward";
  const dayPlanFixture =
    import.meta.env.VITE_GOLDLINE_TEST_HARNESS === "1"
      ? new URLSearchParams(window.location.search).get(
          "goldlineDayPlanFixture"
        )
      : null;

  if (GoldlineDayPlanFixture && dayPlanFixture) {
    return (
      <Suspense fallback={null}>
        <GoldlineDayPlanFixture state={dayPlanFixture} />
      </Suspense>
    );
  }

  if (waywardFixture) {
    return (
      <Suspense
        fallback={
          <div style={{ minHeight: "100dvh", background: "#f2e4bd" }} />
        }
      >
        <WaywardTetheredDeck
          fixture
          playerIdentity="wayward-browser-fixture"
          onReturn={() => history.back()}
        />
      </Suspense>
    );
  }

  if (overworldFixture) {
    const fixtureOrder = {
      id: 5106,
      firstName: "Greystar",
      lastName: "Test Route",
      address: "Overworld Browser Fixture",
      pickupTimeWindow: "TODAY",
      paid: true,
    } as Order;
    return (
      <GoldlineOverworld
        pickups={[fixtureOrder]}
        greystarActive
        playerIdentity="browser-fixture"
        onEnterGreystar={() => {
          document.body.dataset.greystarEntered = "true";
        }}
        onResolveOrder={async () => true}
      />
    );
  }

  return <AuthenticatedDriver />;
}

function AuthenticatedDriver() {
  const [sideQuestOpen, setSideQuestOpen] = useState(false);
  const { loading: authLoading, isAuthenticated } = useAuth();
  const firstWorld=trpc.system.goldlineOnboarding.state.useQuery(undefined,{enabled:isAuthenticated,retry:false});
  const firstMission = firstWorld.data?.session?.status === "COMPLETE" ? firstWorld.data.session.mission : null;
  const firstSparkAvailable = Boolean(firstMission && !firstMission.gameplayCompletedAt);

  useEffect(() => {
    document.documentElement.dataset.goldlineFirstSparkAvailable = String(firstSparkAvailable);
    const openFirstSpark = () => {
      if (firstSparkAvailable) setSideQuestOpen(true);
    };
    window.addEventListener("goldline:first-spark", openFirstSpark);
    return () => {
      window.removeEventListener("goldline:first-spark", openFirstSpark);
      delete document.documentElement.dataset.goldlineFirstSparkAvailable;
    };
  }, [firstSparkAvailable]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-black/30" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <LoginForm role="driver" onSuccess={() => window.location.reload()} />
    );
  }

  if (
    import.meta.env.VITE_GOLDLINE_TEST_HARNESS === "1" &&
    new URLSearchParams(window.location.search).get("fieldJournal") === "1"
  ) {
    return (
      <main className="min-h-screen bg-[#f7d982] p-4">
        <GoldlineDriverController />
        <div className="fixed inset-0 z-[200] grid place-items-end bg-[#8a6a2f33] p-3 sm:place-items-center">
          <SalesJournalSheet open onOpenChange={() => {}} />
        </div>
      </main>
    );
  }

  // Onboarding never owns the driver's route. The first chapter is optional,
  // and opening it always leaves an explicit way back to today's work.
  if (sideQuestOpen && firstMission) return <>
    <button className="driver-return-home" onClick={() => setSideQuestOpen(false)}>← YOUR DAY</button>
    <FirstMissionDriver session={firstWorld.data!.session!} />
  </>;
  return (
    <>
      <ClaireAnalysisInbox />
      <GoldlineDriverController onOpenFirstMission={firstSparkAvailable ? () => setSideQuestOpen(true) : undefined} />
    </>
  );
}