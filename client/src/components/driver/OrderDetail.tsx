/**
 * ORDER DETAIL — Mission Intel view with Google Maps handoff.
 * Bottom CTA advances the machine from `order_detail` → prep tier 1 so the
 * reducer invariants (prep secured before any game phase) still hold.
 */
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Navigation,
  MapPin,
  Package,
  Clock,
  Building2,
  Home,
} from "lucide-react";
import type { GameOrder } from "./driverGameTypes";
import { sounds } from "./driverSounds";
import { haptics } from "./driverHaptics";

interface Props {
  order: GameOrder;
  onStartVerification: () => void;
  onSkipGames: () => void;
  onBack: () => void;
}

export default function OrderDetail({
  order,
  onStartVerification,
  onSkipGames,
  onBack,
}: Props) {
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    order.address + (order.unit ? `, Unit ${order.unit}` : "")
  )}`;

  const handleNavigate = () => {
    sounds.press();
    haptics.impact();
    window.open(mapsUrl, "_blank", "noopener,noreferrer");
  };

  const handleDelivered = () => {
    sounds.scanConfirm();
    haptics.slam();
    onStartVerification();
  };

  const handleSkipGames = () => {
    onSkipGames();
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ duration: 0.25 }}
      className="min-h-[100svh] bg-[#f7f9fb] text-[#111827]"
    >
      <header className="sticky top-0 z-30 flex items-center border-b border-[#dce3ea] bg-white/95 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+14px)] backdrop-blur">
        <button
          onClick={() => {
            sounds.press();
            haptics.tap();
            onBack();
          }}
          className="flex h-12 w-12 items-center justify-center rounded-full text-[#52606d] active:bg-[#eef2f6]"
          aria-label="Back to route"
        >
          <ArrowLeft className="h-7 w-7" />
        </button>
        <div className="flex-1 pr-12 text-center">
          <p className="text-[13px] font-bold uppercase tracking-[0.1em] text-[#667085]">Route stop</p>
          <h1 className="text-[22px] font-extrabold">Order #{order.id}</h1>
        </div>
      </header>

      <main className="space-y-4 px-4 pb-[250px] pt-4">
        <section className="rounded-[22px] border border-[#dce3ea] bg-white p-5 shadow-[0_5px_18px_rgba(15,23,42,0.06)]">
          <div className="mb-5 flex items-center justify-between gap-3">
            <span className={`rounded-full px-3 py-1.5 text-[13px] font-extrabold uppercase tracking-[0.1em] ${
              order.type === "PICKUP"
                ? "bg-[#dceaff] text-[#185abc]"
                : "bg-[#fff0cf] text-[#8a5200]"
            }`}>
              {order.type}
            </span>
            <span className="text-[18px] font-extrabold text-[#344054]">{order.timeWindow}</span>
          </div>

          <p className="text-[13px] font-extrabold uppercase tracking-[0.1em] text-[#667085]">Customer</p>
          <h2 className="mt-2 text-[30px] font-extrabold leading-tight tracking-[-0.025em]">{order.customerName}</h2>
          <div className="mt-5 flex items-start gap-3 border-t border-[#edf0f3] pt-5">
            <MapPin className="mt-0.5 h-6 w-6 shrink-0 text-[#087552]" />
            <p className="text-[18px] font-medium leading-snug text-[#344054]">
            {order.address}
            {order.unit ? ` · Unit ${order.unit}` : ""}
            </p>
          </div>

        {order.buildingName ? (
          <div className="ml-9 mt-3 flex items-center gap-2 text-[#667085]">
            <Building2 className="h-5 w-5" />
            <p className="text-[15px] font-semibold">
              {order.buildingName}
            </p>
          </div>
        ) : null}
        </section>

        <section className="rounded-[22px] border border-[#dce3ea] bg-white p-5 shadow-[0_5px_18px_rgba(15,23,42,0.06)]">
          <p className="text-[13px] font-extrabold uppercase tracking-[0.1em] text-[#667085]">Order</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-[16px] bg-[#f4f7fa] p-4">
              <Package className="h-6 w-6 text-[#087552]" />
              <p className="mt-2 text-[24px] font-black">{order.items}</p>
              <p className="text-[14px] font-semibold text-[#667085]">{order.items === 1 ? "Bag" : "Bags"}</p>
            </div>
            <div className="rounded-[16px] bg-[#f4f7fa] p-4">
              <Clock className="h-6 w-6 text-[#8a5200]" />
              <p className="mt-2 text-[19px] font-black">{order.timeWindow}</p>
              <p className="text-[14px] font-semibold text-[#667085]">Time window</p>
            </div>
          </div>
          <p className="mt-4 border-t border-[#edf0f3] pt-4 text-[16px] font-bold text-[#344054]">Scheduled {order.dateLabel}</p>
        </section>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#dce3ea] bg-white px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)]">
        <div className="mx-auto max-w-xl space-y-3">
          <button
            onClick={handleNavigate}
            className="flex min-h-16 w-full items-center justify-center gap-3 rounded-[16px] bg-[#2468ed] px-5 text-[20px] font-extrabold text-white shadow-[0_5px_0_#1647a5] active:translate-y-1 active:shadow-none"
          >
            <Navigation className="h-6 w-6" />
            Accept and Navigate
          </button>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={handleDelivered}
              className="min-h-14 rounded-[14px] border-2 border-[#111827] bg-[#20e3a2] px-3 text-[15px] font-extrabold text-[#07110d]"
            >
              Mark {order.type === "PICKUP" ? "Picked Up" : "Delivered"}
            </button>
            <button
              type="button"
              onClick={handleSkipGames}
              className="flex min-h-14 items-center justify-center gap-2 rounded-[14px] border border-[#cbd5df] bg-white px-3 text-[15px] font-bold text-[#344054]"
            >
              <Home className="h-5 w-5" />
              Route Home
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
