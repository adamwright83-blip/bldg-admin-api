import { useMemo, useState } from "react";
import { DriverSalesIntelCapture } from "@/components/driver/DriverSalesIntelCapture";
import { instagramShareParamsFromLocation } from "@shared/instagramShareCapture";
import GoldlineDriverCore from "./GoldlineDriverController";

/**
 * Phone-only field-intel chrome around the authoritative Goldline controller.
 * Keeping this wrapper outside Driver.tsx preserves the existing contract that
 * Driver itself only authenticates and hands off to one Goldline controller;
 * mission/order composition remains owned by GoldlineDriverController.
 */
export default function GoldlineDriverController() {
  const shared = useMemo(
    () =>
      typeof window === "undefined"
        ? { sharedUrl: null, wasShareTargetLaunch: false }
        : instagramShareParamsFromLocation(window.location.search),
    []
  );
  const [captureOpen, setCaptureOpen] = useState(shared.wasShareTargetLaunch);

  function closeCapture() {
    setCaptureOpen(false);
    if (shared.wasShareTargetLaunch && typeof window !== "undefined") {
      window.history.replaceState({}, "", "/driver");
    }
  }

  return (
    <>
      <GoldlineDriverCore />
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
