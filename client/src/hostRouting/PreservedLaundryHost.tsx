/* LEGACY DAYFORGE COMPATIBILITY: retained historical route literals only; not current architecture. */
import { lazy, Suspense } from "react";
import {
  LAUNDRY_FARM_HOST,
  normalizeHostname,
  normalizePath,
} from "@shared/joystickHostRouting";
import { useTenant } from "@/hooks/useTenant";
import LaundryButlerAccount from "@/pages/LaundryButlerAccount";

const LaundryButlerWelcome = lazy(() => import("@/pages/LaundryButlerWelcome"));
const LaundryFarmHome = lazy(() => import("@/pages/LaundryFarmHome"));
const DigitalReceiptPage = lazy(() => import("@/pages/DigitalReceiptPage"));
const SchedulePickupRail = lazy(() =>
  import("@/components/SchedulePickupModal").then(module => ({
    default: module.SchedulePickupRail,
  }))
);

function LaundryFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fff7f5] text-[#7f5e6d]">
      Loading your laundry account…
    </main>
  );
}

/**
 * Public Laundry Butler entry and booking route. The /account screen cannot
 * serve as the public homepage: when signed out, its CTA goes to /?book=1.
 * Both / and /?book=1 previously rendered /account, producing a booking loop.
 */
function LaundryButlerPublicHome() {
  const { tenant } = useTenant();
  const bookingRequested =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("book") === "1";

  return (
    <main className="min-h-screen bg-[#fff7f5] text-[#2f1b24]">
      <header className="border-b border-[#eddce4] bg-white/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <a href="/" className="text-lg font-bold tracking-[0.08em] text-[#2f1b24]">
            {tenant.brandName}
          </a>
          <nav className="flex items-center gap-3 text-sm">
            <a href="/account" className="rounded-full px-3 py-2 font-semibold text-[#815d6e] hover:bg-[#fff0f6]">
              My account
            </a>
            {!bookingRequested && (
              <a href="/?book=1" className="rounded-full bg-[#d42f76] px-4 py-2.5 font-semibold text-white hover:bg-[#b92264]">
                Book a pickup
              </a>
            )}
          </nav>
        </div>
      </header>

      {bookingRequested ? (
        <section className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8 sm:py-12">
          <a href="/" className="mb-5 inline-flex text-sm font-semibold text-[#a12862] hover:underline">
            ← Back to Laundry Butler
          </a>
          <Suspense fallback={<LaundryFallback />}>
            <SchedulePickupRail />
          </Suspense>
        </section>
      ) : (
        <section className="mx-auto grid min-h-[calc(100vh-84px)] max-w-6xl items-center gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[1.2fr_0.8fr] lg:py-24">
          <div>
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-[#b72b69]">
              Laundry Butler · Pickup & delivery
            </p>
            <h1 className="max-w-2xl text-4xl font-semibold leading-[1.12] tracking-tight sm:text-6xl">
              Your laundry, taken care of.
            </h1>
            <p className="mt-6 max-w-lg text-base leading-relaxed text-[#795e6a] sm:text-lg">
              Choose your service, enter your pickup address, and select your preferred
              time window. Book your first pickup online in a few steps.
            </p>
            <a href="/?book=1" className="mt-9 inline-flex min-h-12 items-center justify-center rounded-full bg-[#d42f76] px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-pink-200/70 transition hover:bg-[#b92264]">
              Schedule a pickup →
            </a>
            <p className="mt-4 text-sm text-[#906f7e]">
              Already booked? <a href="/account" className="font-semibold text-[#a12862] underline underline-offset-2">View your account</a>
            </p>
          </div>
          <div className="rounded-[32px] border border-[#f0dce5] bg-white p-7 shadow-[0_24px_70px_rgba(96,50,72,0.10)] sm:p-10">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#b72b69]">How booking works</p>
            <ol className="mt-7 space-y-7">
              <li className="flex gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#ffe9f2] font-bold text-[#ae2c66]">1</span>
                <div><p className="font-semibold">Choose a service</p><p className="mt-1 text-sm leading-relaxed text-[#806574]">Wash & fold or dry cleaning.</p></div>
              </li>
              <li className="flex gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#ffe9f2] font-bold text-[#ae2c66]">2</span>
                <div><p className="font-semibold">Schedule pickup</p><p className="mt-1 text-sm leading-relaxed text-[#806574]">Tell us where and when to collect your items.</p></div>
              </li>
              <li className="flex gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#ffe9f2] font-bold text-[#ae2c66]">3</span>
                <div><p className="font-semibold">Complete your booking</p><p className="mt-1 text-sm leading-relaxed text-[#806574]">Review the details and securely add your card on file.</p></div>
              </li>
            </ol>
          </div>
        </section>
      )}
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

  if (path === "/") {
    return <LaundryButlerPublicHome />;
  }

  return <LaundryButlerAccount />;
}
