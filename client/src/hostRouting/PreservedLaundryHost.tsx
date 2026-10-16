/* LEGACY DAYFORGE COMPATIBILITY: retained historical route literals only; not current architecture. */
import { lazy, Suspense } from "react";
import {
  LAUNDRY_FARM_HOST,
  normalizeHostname,
  normalizePath,
} from "@shared/joystickHostRouting";
import LaundryButlerAccount from "@/pages/LaundryButlerAccount";

const LaundryButlerWelcome = lazy(() => import("@/pages/LaundryButlerWelcome"));
const LaundryFarmHome = lazy(() => import("@/pages/LaundryFarmHome"));
const DigitalReceiptPage = lazy(() => import("@/pages/DigitalReceiptPage"));

function LaundryFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fff7f5] text-[#7f5e6d]">
      Loading your laundry account…
    </main>
  );
}

/**
 * laundrybutler.bldg.chat and laundryfarm.bldg.chat keep their own sites.
 * They do not mount the JOYSTICK admin shell, driver shell, SaaS product, or
 * marketing homepage.
 */
export function PreservedLaundryHost() {
  const hostname =
    typeof window !== "undefined" ? normalizeHostname(window.location.hostname) : "";
  const path =
    typeof window !== "undefined" ? normalizePath(window.location.pathname) : "/";

  if (hostname === LAUNDRY_FARM_HOST) {
    return (
      <Suspense fallback={<LaundryFallback />}>
        <LaundryFarmHome />
      </Suspense>
    );
  }

  if (path === "/welcome") {
    return (
      <Suspense fallback={<LaundryFallback />}>
        <LaundryButlerWelcome />
      </Suspense>
    );
  }

  if (path.startsWith("/receipt/")) {
    return (
      <Suspense fallback={<LaundryFallback />}>
        <DigitalReceiptPage />
      </Suspense>
    );
  }

  return <LaundryButlerAccount />;
}
