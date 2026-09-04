import { VehicleCargo } from "@/components/goldline/VehicleCargo";
import { trpc } from "@/lib/trpc";
import { FirstMissionDriver } from "@/components/goldline/onboarding/FirstMissionDriver";
import { Loader2 } from "lucide-react";
import { lazy, Suspense } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { LoginForm } from "@/components/LoginForm";
import GoldlineDriverController from "./driver/GoldlineDriverController";
import GoldlineOverworld from "./goldline/GoldlineOverworld";
import { SalesJournalSheet } from "@/components/driver/SalesMomentum";
import type { Order } from "@shared/types";
import "./goldline/goldline-legibility.css";
import "./goldline/goldline-live-fix.css";
import "./goldline/goldline-import-overlay.css";

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
          <div style={{ minHeight: "100dvh", background: "#03070c" }} />
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
  const { loading: authLoading, isAuthenticated } = useAuth();
  const firstWorld=trpc.system.goldlineOnboarding.state.useQuery(undefined,{enabled:isAuthenticated,retry:false});
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
        <div className="fixed inset-0 z-[200] grid place-items-end bg-[#17385e55] p-3 sm:place-items-center">
          <SalesJournalSheet open onOpenChange={() => {}} />
        </div>
      </main>
    );
  }

  // Day two: the first mission owns Driver only until it is fully resolved. Once
  // the operator has recorded real field evidence AND closed the fictional
  // encounter, Driver hands back to the real controller so Today's Line reweaves
  // from ongoing truth instead of replaying a finished first chapter forever.
  const firstMission = firstWorld.data?.session?.status === "COMPLETE" ? firstWorld.data.session.mission : null;
  if (firstMission && !firstMission.gameplayCompletedAt) return <><FirstMissionDriver session={firstWorld.data!.session!} /><VehicleCargo /></>;
  return <GoldlineDriverController />;
}
