import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { LoginForm } from "@/components/LoginForm";
import { DriverSalesIntelCapture } from "@/components/driver/DriverSalesIntelCapture";
import { instagramShareParamsFromLocation } from "@shared/instagramShareCapture";
import GoldlineDriverController from "./driver/GoldlineDriverController";
import "./goldline/goldline-legibility.css";
import "./goldline/goldline-live-fix.css";

export default function Driver() {
  const { loading: authLoading, isAuthenticated } = useAuth();
  const shared = useMemo(
    () =>
      typeof window === "undefined"
        ? { sharedUrl: null, wasShareTargetLaunch: false }
        : instagramShareParamsFromLocation(window.location.search),
    []
  );
  const [captureOpen, setCaptureOpen] = useState(shared.wasShareTargetLaunch);

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

  function closeCapture() {
    setCaptureOpen(false);
    if (shared.wasShareTargetLaunch && typeof window !== "undefined") {
      window.history.replaceState({}, "", "/driver");
    }
  }

  return (
    <>
      <GoldlineDriverController />
      <button
        type="button"
        className="driver-intel-launch"
        onClick={() => setCaptureOpen(true)}
        aria-label="Capture Instagram Sales Intel"
      >
        + CAPTURE INTEL
      </button>
      {captureOpen ? (
        <DriverSalesIntelCapture
          initialUrl={shared.sharedUrl ?? ""}
          shareLaunch={shared.wasShareTargetLaunch}
          onClose={closeCapture}
        />
      ) : null}
    </>
  );
}
