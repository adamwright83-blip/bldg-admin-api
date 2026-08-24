import { Loader2 } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { LoginForm } from "@/components/LoginForm";
import GoldlineDriverController from "./driver/GoldlineDriverController";
import GoldlineOverworld from "./goldline/GoldlineOverworld";
import type { Order } from "@shared/types";
import "./goldline/goldline-legibility.css";
import "./goldline/goldline-live-fix.css";

export default function Driver() {
  const { loading: authLoading, isAuthenticated } = useAuth();
  const overworldFixture =
    import.meta.env.VITE_GOLDLINE_TEST_HARNESS === "1" &&
    new URLSearchParams(window.location.search).has("goldlineOverworldFixture");

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

  return <GoldlineDriverController />;
}
