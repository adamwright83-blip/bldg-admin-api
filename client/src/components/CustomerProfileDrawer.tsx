import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Loader2, Copy, ExternalLink, FileText, Mail, MessageSquare, Phone } from "lucide-react";

function formatMoney(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatStatusLabel(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function statusBadgeClass(token: string) {
  switch (token) {
    case "success":
      return "bg-green-100 text-green-700";
    case "warning":
      return "bg-amber-100 text-amber-700";
    case "danger":
      return "bg-red-100 text-red-700";
    case "info":
      return "bg-blue-100 text-blue-700";
    case "muted":
      return "bg-neutral-200 text-neutral-600";
    default:
      return "bg-neutral-100 text-neutral-700";
  }
}

function formatDateTime(d: Date) {
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function telHref(phone: string) {
  const digits = phone.replace(/[^\d+]/g, "");
  return `tel:${digits || phone}`;
}

function smsHref(phone: string) {
  const digits = phone.replace(/\D/g, "");
  const core = digits.startsWith("1") && digits.length === 11 ? digits.slice(1) : digits;
  return `sms:${core}`;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phone: string | null;
  onPrefillNewOrder: (phone: string) => void;
};

export function CustomerProfileDrawer({
  open,
  onOpenChange,
  phone,
  onPrefillNewOrder,
}: Props) {
  const [orderWindow, setOrderWindow] = useState<"all" | "30d" | "90d">("all");
  const profile = trpc.admin.getCustomerProfile.useQuery(
    { phone: phone ?? "" },
    { enabled: open && !!phone && phone.length >= 3 }
  );

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  };

  const filteredOrders = useMemo(() => {
    const orders = profile.data?.orders ?? [];
    if (orderWindow === "all") return orders;
    const maxDays = orderWindow === "30d" ? 30 : 90;
    return orders.filter((o) => {
      const days = Math.floor((Date.now() - new Date(o.createdAt).getTime()) / (24 * 60 * 60 * 1000));
      return days <= maxDays;
    });
  }, [orderWindow, profile.data?.orders]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl flex flex-col overflow-hidden border-black/15"
      >
        <SheetHeader className="text-left border-b border-black/10 pb-4 shrink-0">
          <SheetTitle className="text-black">Customer profile</SheetTitle>
          <SheetDescription className="text-black/50">
            Grouped by phone. Lifetime spend counts paid orders only.
          </SheetDescription>
        </SheetHeader>

        {!phone ? (
          <p className="text-sm text-black/50 p-4">No phone selected.</p>
        ) : profile.isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-black/30" />
          </div>
        ) : profile.data === null || !profile.data ? (
          <p className="text-sm text-black/50 p-4">No orders for this phone.</p>
        ) : (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="overflow-y-auto flex-1 space-y-6 py-4 px-1">
              {/* Overview */}
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-black/40 mb-2">
                  Overview
                </h3>
                <div className="rounded-md border border-black/10 bg-neutral-50/80 p-4 space-y-2 text-sm">
                  <p className="text-lg font-medium text-black">
                    {profile.data.overview.firstName} {profile.data.overview.lastName}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-black/70">{profile.data.phone}</p>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${statusBadgeClass(profile.data.overview.statusColor)}`}>
                      {formatStatusLabel(profile.data.overview.recencyStatus)}
                    </span>
                    <span className="inline-flex rounded-full px-2 py-0.5 text-xs bg-black text-white uppercase">
                      {profile.data.overview.tier}
                    </span>
                  </div>
                  {profile.data.overview.email && (
                    <p className="text-black/70">{profile.data.overview.email}</p>
                  )}
                  <p className="text-black/60">
                    Unit {profile.data.overview.unit || "—"} · Building{" "}
                    {profile.data.overview.buildingSlug || "—"}
                  </p>
                  <p className="text-black/50 text-xs leading-relaxed">
                    {profile.data.overview.address}
                  </p>
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-black/10 mt-2">
                    <div>
                      <p className="text-[10px] uppercase text-black/40">Lifetime spend</p>
                      <p className="font-semibold text-black">
                        {formatMoney(profile.data.overview.lifetimeSpend)}
                      </p>
                      <p className="text-[10px] text-black/45">Paid orders only</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-black/40">Total orders</p>
                      <p className="font-semibold text-black">{profile.data.overview.totalOrders}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-black/40">Avg order value</p>
                      <p className="font-medium text-black text-xs">
                        {profile.data.overview.avgOrderValue == null
                          ? "—"
                          : formatMoney(profile.data.overview.avgOrderValue)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-black/40">Last order</p>
                      <p className="font-medium text-black text-xs">
                        {profile.data.overview.lastOrderAt
                          ? `${formatDateTime(profile.data.overview.lastOrderAt)} (${profile.data.overview.daysSinceLastOrder}d ago)`
                          : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-black/40">Orders last 30 days</p>
                      <p className="font-medium text-black text-xs">
                        {profile.data.overview.ordersLast30Days}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-black/40">Orders last 90 days</p>
                      <p className="font-medium text-black">
                        {profile.data.overview.ordersLast90Days}
                      </p>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-black/10">
                    <p className="text-[10px] uppercase text-black/40 mb-1">Resident app</p>
                    {profile.data.overview.bldgUserIds.length > 0 ? (
                      <p className="text-xs text-black/70">
                        bldgUserId: {profile.data.overview.bldgUserIds.join(", ")}
                      </p>
                    ) : (
                      <p className="text-xs text-black/50">
                        No bldgUserId on orders. Chat history is not available in admin.
                      </p>
                    )}
                  </div>
                </div>
              </section>

              {/* Orders */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-black/40">
                    Orders
                  </h3>
                  <div className="flex gap-1">
                    <Button type="button" size="sm" variant={orderWindow === "all" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setOrderWindow("all")}>All</Button>
                    <Button type="button" size="sm" variant={orderWindow === "30d" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setOrderWindow("30d")}>Last 30</Button>
                    <Button type="button" size="sm" variant={orderWindow === "90d" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setOrderWindow("90d")}>Last 90</Button>
                  </div>
                </div>
                <ul className="space-y-2">
                  {filteredOrders.map((o) => (
                    <li
                      key={o.id}
                      className="rounded-md border border-black/10 p-3 text-sm flex flex-col gap-2"
                    >
                      <div className="flex justify-between gap-2">
                        <span className="font-medium text-black">#{o.id}</span>
                        <span className="text-black/50 text-xs">{formatDateTime(o.createdAt)}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-black/60">
                        <span>{o.serviceType === "wash_fold" ? "Wash & fold" : "Dry cleaning"}</span>
                        <span>{o.paid ? formatMoney(parseFloat(o.total || "0")) : o.total ? `$${o.total} (unpaid)` : "—"}</span>
                        <span className="capitalize">{o.status}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" className="h-8 border-black/20" asChild>
                          <a href={o.adminReceiptHref} target="_blank" rel="noopener noreferrer">
                            <FileText className="w-3.5 h-3.5 mr-1" />
                            Receipt
                          </a>
                        </Button>
                        {o.externalReceiptUrl && (
                          <Button variant="outline" size="sm" className="h-8 border-black/20" asChild>
                            <a href={o.externalReceiptUrl} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="w-3.5 h-3.5 mr-1" />
                              App receipt
                            </a>
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                  {filteredOrders.length === 0 && (
                    <li className="rounded-md border border-black/10 p-3 text-xs text-black/50">
                      No orders in this time window.
                    </li>
                  )}
                </ul>
              </section>
            </div>

            {/* Actions */}
            <div className="shrink-0 border-t border-black/10 pt-4 space-y-2 bg-white">
              <Button
                className="w-full bg-black text-white hover:bg-black/90"
                onClick={() => {
                  onPrefillNewOrder(profile.data!.phone);
                  onOpenChange(false);
                }}
              >
                Prefill new order
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" className="border-black/20" asChild>
                  <a
                    href={profile.data.orders[0]?.adminReceiptHref || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <FileText className="w-3.5 h-3.5 mr-1 inline" />
                    Latest receipt
                  </a>
                </Button>
                <Button variant="outline" size="sm" className="border-black/20" asChild>
                  <a href={telHref(profile.data.phone)}>
                    <Phone className="w-3.5 h-3.5 mr-1 inline" />
                    Call
                  </a>
                </Button>
                <Button variant="outline" size="sm" className="border-black/20" asChild>
                  <a href={smsHref(profile.data.phone)}>
                    <MessageSquare className="w-3.5 h-3.5 mr-1 inline" />
                    Text
                  </a>
                </Button>
              </div>
              {profile.data.overview.email && (
                <Button variant="outline" size="sm" className="w-full border-black/20" asChild>
                  <a href={`mailto:${profile.data.overview.email}`}>
                    <Mail className="w-3.5 h-3.5 mr-1 inline" />
                    Email
                  </a>
                </Button>
              )}
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 text-black/60"
                  onClick={() => copy(profile.data!.phone)}
                >
                  <Copy className="w-3.5 h-3.5 mr-1" />
                  Copy phone
                </Button>
                {profile.data.overview.email && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1 text-black/60"
                    onClick={() => copy(profile.data!.overview.email!)}
                  >
                    <Copy className="w-3.5 h-3.5 mr-1" />
                    Copy email
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
