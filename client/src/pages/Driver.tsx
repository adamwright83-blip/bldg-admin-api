import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { LoginForm } from "@/components/LoginForm";
import { Button } from "@/components/ui/button";
import { Loader2, MapPin, Phone, MessageSquare, Package } from "lucide-react";
import type { Order } from "@shared/types";
import { matchBuilding } from "@shared/buildings";

/** Returns the delivery date string: pickupDate + 1 calendar day */
function computeDeliveryDate(pickupDate: string): string {
  const [y, m, d] = pickupDate.split("-").map(Number);
  const next = new Date(y, m - 1, d + 1);
  return (
    next.getFullYear() +
    "-" +
    String(next.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(next.getDate()).padStart(2, "0")
  );
}

/** Format a YYYY-MM-DD string as "Mon Feb 24" */
function formatPickupDate(dateStr: string): string {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function Driver() {
  const { loading: authLoading, isAuthenticated } = useAuth();

  // PICKUPS: orders placed by residents, ready to be picked up
  const pickupQuery = trpc.admin.listByStatus.useQuery({ status: "new" });

  // DELIVERIES: orders processed by admin, ready to be delivered back
  const deliveryQuery = trpc.admin.listByStatus.useQuery({ status: "ready" });

  const updateStatus = trpc.admin.updateStatus.useMutation();

  const handlePickedUp = async (orderId: number) => {
    await updateStatus.mutateAsync({ orderId, status: "collected" });
    pickupQuery.refetch();
  };

  const handleDelivered = async (orderId: number) => {
    await updateStatus.mutateAsync({ orderId, status: "delivered" });
    deliveryQuery.refetch();
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

  return (
    <div className="min-h-screen bg-white text-black" style={{ fontFamily: '"Inter", system-ui, sans-serif' }}>
      {/* Header */}
      <div className="sticky top-0 z-50 bg-black text-white px-4 py-3">
        <p className="text-sm font-semibold tracking-widest uppercase text-center">Driver</p>
      </div>

      {/* Content */}
      <div className="px-4 py-4 max-w-lg mx-auto">

        {/* PICKUPS section */}
        <div className="mb-8">
          <h3 className="text-xs font-semibold text-black/50 uppercase tracking-wider mb-3">
            Pickups ({pickupQuery.data?.length || 0})
          </h3>
          {pickupQuery.isLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="animate-spin w-5 h-5 text-black/30" />
            </div>
          ) : !pickupQuery.data?.length ? (
            <p className="text-sm text-black/30 py-4 text-center">No pickups scheduled.</p>
          ) : (
            <div className="space-y-3">
              {pickupQuery.data.map((o) => (
                <DriverStopCard
                  key={o.id}
                  order={o}
                  dateLabel={formatPickupDate(o.pickupDate)}
                  datePrefix="Pickup"
                  timeWindow={o.pickupTimeWindow}
                  actionLabel="Mark Picked Up"
                  onAction={() => handlePickedUp(o.id)}
                  isPending={updateStatus.isPending}
                />
              ))}
            </div>
          )}
        </div>

        {/* DELIVERIES section */}
        <div>
          <h3 className="text-xs font-semibold text-black/50 uppercase tracking-wider mb-3">
            Deliveries ({deliveryQuery.data?.length || 0})
          </h3>
          {deliveryQuery.isLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="animate-spin w-5 h-5 text-black/30" />
            </div>
          ) : !deliveryQuery.data?.length ? (
            <p className="text-sm text-black/30 py-4 text-center">No deliveries scheduled.</p>
          ) : (
            <div className="space-y-3">
              {deliveryQuery.data.map((o) => (
                <DriverStopCard
                  key={o.id}
                  order={o}
                  dateLabel={formatPickupDate(computeDeliveryDate(o.pickupDate))}
                  datePrefix="Delivery"
                  timeWindow={o.pickupTimeWindow}
                  actionLabel="Mark Delivered"
                  onAction={() => handleDelivered(o.id)}
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
  dateLabel,
  datePrefix,
  timeWindow,
  actionLabel,
  onAction,
  isPending,
  showBags,
}: {
  order: Order;
  dateLabel: string;
  datePrefix: "Pickup" | "Delivery";
  timeWindow: string;
  actionLabel: string;
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
      {/* Date/time banner */}
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-black/5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-black/40">
          {datePrefix}
        </span>
        <span className="text-xs font-medium text-black">
          {dateLabel} · {timeWindow}
        </span>
      </div>

      {/* Customer name + unit + service badge */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="font-medium text-sm">
            {order.firstName} {order.lastName}
          </p>
          <p className="text-xs text-black/50">Unit {order.unit || "—"}</p>
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
        {actionLabel}
      </Button>
    </div>
  );
}
