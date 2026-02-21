import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronLeft, ChevronRight, MapPin, Phone, MessageSquare, Package } from "lucide-react";
import type { Order } from "@shared/types";
import { matchBuilding } from "@shared/buildings";

function getWeekDates(offset: number) {
  const today = new Date();
  today.setDate(today.getDate() + offset * 7);
  const day = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((day + 6) % 7));
  const dates: { label: string; shortLabel: string; value: string; isToday: boolean }[] = [];
  const todayStr = new Date().toISOString().split("T")[0];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const val = d.toISOString().split("T")[0];
    dates.push({
      label: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
      shortLabel: d.toLocaleDateString("en-US", { weekday: "short", day: "numeric" }),
      value: val,
      isToday: val === todayStr,
    });
  }
  return dates;
}

export default function Driver() {
  const { loading: authLoading, isAuthenticated } = useAuth();
  const [weekOffset, setWeekOffset] = useState(0);
  const dates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);
  const todayStr = new Date().toISOString().split("T")[0];
  const [selectedDate, setSelectedDate] = useState(todayStr);

  const { data: pickups, refetch: refetchPickups } = trpc.admin.listByDate.useQuery({
    date: selectedDate,
    status: "new",
    dateField: "pickupDate",
  });

  const { data: deliveries, refetch: refetchDeliveries } = trpc.admin.listByDate.useQuery({
    date: selectedDate,
    status: "ready",
    dateField: "deliveryDate",
  });

  const updateStatus = trpc.admin.updateStatus.useMutation();

  const handleCollect = async (orderId: number) => {
    await updateStatus.mutateAsync({ orderId, status: "collected" });
    refetchPickups();
  };

  const handleDeliver = async (orderId: number) => {
    await updateStatus.mutateAsync({ orderId, status: "delivered" });
    refetchDeliveries();
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="animate-spin w-8 h-8 text-black/30" />
      </div>
    );
  }

  if (!isAuthenticated) {
    window.location.href = getLoginUrl();
    return null;
  }

  return (
    <div className="min-h-screen bg-white text-black" style={{ fontFamily: '"Inter", system-ui, sans-serif' }}>
      {/* Header */}
      <div className="sticky top-0 z-50 bg-black text-white px-4 py-3">
        <p className="text-sm font-semibold tracking-widest uppercase text-center">Driver</p>
      </div>

      {/* Day selector */}
      <div className="sticky top-[44px] z-40 bg-white border-b border-black/10 px-2 py-2">
        <div className="flex items-center gap-1 overflow-x-auto">
          <button onClick={() => setWeekOffset(weekOffset - 1)} className="p-1.5 hover:bg-black/5 shrink-0">
            <ChevronLeft className="w-4 h-4" />
          </button>
          {dates.map((d) => (
            <button
              key={d.value}
              onClick={() => setSelectedDate(d.value)}
              className={`px-2.5 py-2 text-xs whitespace-nowrap border transition-colors shrink-0 ${
                selectedDate === d.value
                  ? "bg-black text-white border-black"
                  : d.isToday
                  ? "bg-white text-black border-black/40 font-medium"
                  : "bg-white text-black/50 border-black/10"
              }`}
            >
              {d.shortLabel}
            </button>
          ))}
          <button onClick={() => setWeekOffset(weekOffset + 1)} className="p-1.5 hover:bg-black/5 shrink-0">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-4 max-w-lg mx-auto">
        {/* Pickups section */}
        <div className="mb-8">
          <h3 className="text-xs font-semibold text-black/50 uppercase tracking-wider mb-3">
            Pickups ({pickups?.length || 0})
          </h3>
          {!pickups?.length ? (
            <p className="text-sm text-black/30 py-4 text-center">No pickups.</p>
          ) : (
            <div className="space-y-3">
              {pickups.map((o) => (
                <DriverStopCard
                  key={o.id}
                  order={o}
                  action="Collected"
                  onAction={() => handleCollect(o.id)}
                  isPending={updateStatus.isPending}
                />
              ))}
            </div>
          )}
        </div>

        {/* Deliveries section */}
        <div>
          <h3 className="text-xs font-semibold text-black/50 uppercase tracking-wider mb-3">
            Deliveries ({deliveries?.length || 0})
          </h3>
          {!deliveries?.length ? (
            <p className="text-sm text-black/30 py-4 text-center">No deliveries.</p>
          ) : (
            <div className="space-y-3">
              {deliveries.map((o) => (
                <DriverStopCard
                  key={o.id}
                  order={o}
                  action="Delivered"
                  onAction={() => handleDeliver(o.id)}
                  isPending={updateStatus.isPending}
                  showBags
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ===== DRIVER STOP CARD ===== */
function DriverStopCard({
  order,
  action,
  onAction,
  isPending,
  showBags,
}: {
  order: Order;
  action: string;
  onAction: () => void;
  isPending: boolean;
  showBags?: boolean;
}) {
  const fullAddress = order.address + (order.unit ? `, Unit ${order.unit}` : "");
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`;
  const normalizedPhone = order.phone.replace(/[^\d+]/g, "");
  const phoneDigits = normalizedPhone.startsWith("+") ? normalizedPhone : normalizedPhone.replace(/^1/, "+1") || normalizedPhone;

  // Config-driven building match
  const building = matchBuilding(order.address);

  // Parse address into street and city/state/zip
  const addressParts = order.address.split(",").map((s: string) => s.trim());
  const streetLine = addressParts[0] || order.address;
  const cityStateZip = addressParts.length > 1 ? addressParts.slice(1).join(", ") : "";

  return (
    <div className="border border-black/10 p-4">
      {/* Customer name + unit + service badge */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="font-medium text-sm">
            {order.firstName} {order.lastName}
          </p>
          <p className="text-xs text-black/50">Unit {order.unit || "—"} · {order.pickupTimeWindow}</p>
        </div>
        <span className="text-[10px] text-black/30 uppercase tracking-wider">
          {order.serviceType === "wash_fold" ? "W&F" : "DC"}
        </span>
      </div>

      {/* Full address — tappable → Google Maps */}
      <a
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-start gap-1.5 text-xs text-black/60 hover:text-black mb-2 group"
      >
        <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <div>
          <span className="underline group-hover:text-black">{streetLine}</span>
          {cityStateZip && (
            <span className="block text-[11px] text-black/40">{cityStateZip}</span>
          )}
        </div>
      </a>

      {/* Phone + Call/Text icons */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-xs text-black/60">{order.phone}</span>
        <a href={`tel:${phoneDigits}`} title="Call" className="text-black/40 hover:text-black transition-colors">
          <Phone className="w-3.5 h-3.5" />
        </a>
        <a href={`sms:${phoneDigits}`} title="Text" className="text-black/40 hover:text-black transition-colors">
          <MessageSquare className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Bags for deliveries */}
      {showBags && (
        <div className="flex items-center gap-1.5 text-xs text-black/60 mb-2">
          <Package className="w-3.5 h-3.5 shrink-0" />
          <span>
            {order.bagCount || 0} bag{(order.bagCount || 0) !== 1 ? "s" : ""}
            {order.garmentCount ? ` · ${order.garmentCount} garments` : ""}
          </span>
        </div>
      )}

      {/* Special instructions */}
      {order.specialInstructions && (
        <p className="text-xs text-black/40 italic mb-3">{order.specialInstructions}</p>
      )}

      {/* Building access protocol (config-driven) */}
      {building?.accessProtocol && (
        <div className="bg-black/5 border border-black/10 p-2.5 mb-3 text-xs text-black/70">
          <p className="font-medium text-black mb-0.5">{building.name} — Access Protocol</p>
          <p>{building.accessProtocol.replace("unit floor", `Unit ${order.unit || "—"} floor`)}</p>
        </div>
      )}

      {/* Action button */}
      <Button
        className="bg-black text-white hover:bg-black/90 w-full text-xs"
        onClick={onAction}
        disabled={isPending}
      >
        {isPending ? <Loader2 className="animate-spin w-3 h-3 mr-1" /> : null}
        Mark {action}
      </Button>
    </div>
  );
}
