import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import type { Order } from "@shared/types";
import type { ReactNode } from "react";
import {
  LIVE_LANES,
  amountCents,
  customerName,
  isActionableDelivered,
  isToday,
  money,
  nextLiveActionLabel,
  nextLiveStatus,
  olderThan24Hours,
  phoneHref,
  pickOneThingRightNow,
  serviceLabel,
  shortBuilding,
  statusTone,
  syncSelectedOrder,
  type LiveStatus,
} from "./adminLiveModel";

type AdminLiveProps = {
  onNavigate: (path: string) => void;
  onOpenCustomer: (phone: string) => void;
};

function MiniMetric({ label, value, tone = "text-black" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="border-r border-[#D8D1C4] px-4 py-3 last:border-r-0">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-black/55">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-semibold leading-none ${tone}`}>{value}</div>
    </div>
  );
}

export default function AdminLive({ onNavigate, onOpenCustomer }: AdminLiveProps) {
  const utils = trpc.useUtils();
  const [clock, setClock] = useState(new Date());
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const statusQueries = {
    new: trpc.admin.listByStatus.useQuery({ status: "new" }),
    collected: trpc.admin.listByStatus.useQuery({ status: "collected" }),
    processing: trpc.admin.listByStatus.useQuery({ status: "processing" }),
    ready: trpc.admin.listByStatus.useQuery({ status: "ready" }),
    delivered: trpc.admin.listByStatus.useQuery({ status: "delivered" }),
  };
  const summary = trpc.admin.dashboardSummary.useQuery();
  const updateStatus = trpc.admin.updateStatus.useMutation();
  const chargeCard = trpc.admin.chargeCard.useMutation();

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const ordersByStatus = useMemo(() => ({
    new: statusQueries.new.data ?? [],
    collected: statusQueries.collected.data ?? [],
    processing: statusQueries.processing.data ?? [],
    ready: statusQueries.ready.data ?? [],
    delivered: statusQueries.delivered.data ?? [],
  }), [
    statusQueries.new.data,
    statusQueries.collected.data,
    statusQueries.processing.data,
    statusQueries.ready.data,
    statusQueries.delivered.data,
  ]);

  const unpaidDelivered = ordersByStatus.delivered.filter((o) => !o.paid);
  const actionableDelivered = ordersByStatus.delivered.filter(isActionableDelivered);
  const liveLaneOrders: Record<LiveStatus, Order[]> = {
    ...ordersByStatus,
    delivered: actionableDelivered,
  };
  const allLiveOrders = useMemo(
    () => Object.values(ordersByStatus).flat(),
    [ordersByStatus]
  );
  const selectedOrder = syncSelectedOrder(selectedOrderId, allLiveOrders);
  const readyDueToday = ordersByStatus.ready.filter((o) => isToday(o.deliveryDate));
  const readyToCharge = [...ordersByStatus.ready, ...ordersByStatus.delivered].filter((o) => !o.paid && amountCents(o) >= 50);
  const blocked = unpaidDelivered.filter((o) => olderThan24Hours(o.updatedAt ?? o.createdAt));
  const staleCollectedOrProcessing = [...ordersByStatus.collected, ...ordersByStatus.processing].filter((o) => olderThan24Hours(o.updatedAt ?? o.createdAt));
  const priority = pickOneThingRightNow({
    unpaidDelivered,
    readyDueToday,
    newOrders: ordersByStatus.new,
    staleCollectedOrProcessing,
    blocked,
  });
  const loading = Object.values(statusQueries).some((q) => q.isLoading);

  useEffect(() => {
    if (selectedOrderId && !selectedOrder && !loading) setSelectedOrderId(null);
  }, [loading, selectedOrder, selectedOrderId]);

  async function invalidateLive() {
    await Promise.all([
      utils.admin.listByStatus.invalidate({ status: "new" }),
      utils.admin.listByStatus.invalidate({ status: "collected" }),
      utils.admin.listByStatus.invalidate({ status: "processing" }),
      utils.admin.listByStatus.invalidate({ status: "ready" }),
      utils.admin.listByStatus.invalidate({ status: "delivered" }),
      utils.admin.dashboardSummary.invalidate(),
      utils.admin.listByDate.invalidate(),
    ]);
  }

  async function moveOrder(order: Order, status: LiveStatus) {
    try {
      await updateStatus.mutateAsync({ orderId: order.id, status });
      await invalidateLive();
      toast.success(`#LB-${order.id} moved to ${status}.`);
    } catch (error: any) {
      toast.error(error?.message || "Could not update order.");
    }
  }

  async function runNextStatusAction(order: Order) {
    const next = nextLiveStatus(order);
    if (!next) {
      onNavigate(`/intake?orderId=${order.id}`);
      return;
    }
    await moveOrder(order, next);
  }

  function openOrder(order: Order) {
    setSelectedOrderId(order.id);
    onOpenCustomer(order.phone);
  }

  async function charge(order: Order) {
    const cents = amountCents(order);
    if (cents < 50 || (!order.stripeCustomerId && !order.stripePaymentMethodId)) {
      onNavigate(`/intake?orderId=${order.id}`);
      return;
    }
    try {
      const result = await chargeCard.mutateAsync({ orderId: order.id, amountCents: cents });
      if (result.success) {
        await invalidateLive();
        toast.success(`Charged ${money(order.total)} for #LB-${order.id}.`);
      } else {
        toast.error(result.error || "Charge failed. Open Intake to resolve.");
      }
    } catch (error: any) {
      toast.error(error?.message || "Charge failed. Open Intake to resolve.");
    }
  }

  async function copySms(order: Order) {
    const text = `Laundry Butler update for order #LB-${order.id}: ${order.status.replace("_", " ")}.`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("SMS copied.");
    } catch {
      toast.error("Could not copy SMS.");
    }
  }

  function OrderCard({ order, lane }: { order: Order; lane: (typeof LIVE_LANES)[number] }) {
    const hasCard = !!(order.stripeCustomerId || order.stripePaymentMethodId);
    const isSelected = selectedOrderId === order.id;
    return (
      <article
        className={`relative cursor-pointer border bg-[#FBFAF6] pl-3 pr-3 py-3 transition ${
          isSelected ? "border-black shadow-[inset_0_0_0_1px_#000]" : "border-[#D8D1C4] hover:border-black/35"
        }`}
        onClick={() => setSelectedOrderId(order.id)}
        aria-selected={isSelected}
      >
        <span className={`absolute left-0 top-0 h-full w-0.5 ${lane.rail}`} />
        <div className="flex items-start justify-between gap-2">
          <div className="font-mono text-[11px] font-semibold text-black/65">#LB-{order.id}</div>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${order.paid ? "bg-emerald-600" : hasCard ? "bg-blue-600" : "bg-amber-500"}`} />
        </div>
        <button className="mt-1 text-left text-[13px] font-bold uppercase tracking-[0.08em]" onClick={(event) => { event.stopPropagation(); openOrder(order); }}>
          {customerName(order)}
        </button>
        <div className="mt-1 space-y-0.5 text-[11px] uppercase tracking-[0.08em] text-black/70">
          <div>{shortBuilding(order)} {order.unit ? `/ UNIT ${order.unit}` : ""}</div>
          <div>{serviceLabel(order.serviceType)}</div>
          <div>{order.bagCount ?? "-"} bags{order.garmentCount ? ` / ${order.garmentCount} garments` : ""}{order.weightLbs ? ` / ${order.weightLbs} lb` : ""}</div>
          <div>{order.status === "ready" || order.status === "delivered" ? "Return" : "Pickup"} {order.deliveryTimeWindow || order.pickupTimeWindow || "window n/a"}</div>
          <div className={statusTone(order)}>
            {order.paid ? "Paid" : hasCard ? "Card on file" : "Payment needs intake"} / {money(order.total)}
          </div>
        </div>
        {order.specialInstructions ? <div className="mt-2 border-t border-[#D8D1C4] pt-2 text-[11px] text-black/55 line-clamp-2">{order.specialInstructions}</div> : null}
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {order.phone && lane.status !== "processing" ? (
            <a className="border border-[#C9C0B1] bg-white px-2 py-1 text-center text-[10px] font-bold uppercase tracking-[0.08em] hover:bg-black hover:text-white" href={phoneHref(order.phone)} onClick={(event) => event.stopPropagation()}>
              Text
            </a>
          ) : lane.status === "processing" ? (
            <button className="border border-[#C9C0B1] bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] hover:bg-black hover:text-white" onClick={(event) => { event.stopPropagation(); openOrder(order); }}>
              Notes
            </button>
          ) : null}
          <button className="border border-[#C9C0B1] bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] hover:bg-black hover:text-white" onClick={(event) => { event.stopPropagation(); openOrder(order); }}>
            View
          </button>
          {lane.next ? (
            <button className="border border-black bg-black px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-white hover:bg-black/80 disabled:opacity-50" disabled={updateStatus.isPending} onClick={(event) => { event.stopPropagation(); setSelectedOrderId(order.id); moveOrder(order, lane.next!); }}>
              {lane.nextLabel}
            </button>
          ) : order.paid ? (
            <a className="border border-[#C9C0B1] bg-white px-2 py-1 text-center text-[10px] font-bold uppercase tracking-[0.08em] hover:bg-black hover:text-white" href={`/receipt/${order.id}`} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
              Receipt
            </a>
          ) : (
            <button className="border border-black bg-black px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-white hover:bg-black/80 disabled:opacity-50" disabled={chargeCard.isPending} onClick={(event) => { event.stopPropagation(); setSelectedOrderId(order.id); charge(order); }}>
              {hasCard && amountCents(order) >= 50 ? "Charge" : "Intake"}
            </button>
          )}
        </div>
      </article>
    );
  }

  return (
    <div className="min-h-screen bg-[#F4F1EA] text-black">
      <div className="border-b border-[#D8D1C4] bg-[#FBFAF6] px-4 py-3 xl:px-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="font-mono text-xs uppercase tracking-[0.12em] text-black/70">
            {clock.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "2-digit", year: "numeric" })} / {clock.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })} / Los Angeles, CA
          </div>
          <div className="grid grid-cols-2 border border-[#D8D1C4] bg-white sm:grid-cols-5">
            <MiniMetric label="Open orders" value={String(ordersByStatus.new.length + ordersByStatus.collected.length + ordersByStatus.processing.length + ordersByStatus.ready.length).padStart(2, "0")} />
            <MiniMetric label="Pickups due" value={String(ordersByStatus.new.filter((o) => isToday(o.pickupDate)).length || ordersByStatus.new.length).padStart(2, "0")} tone="text-emerald-700" />
            <MiniMetric label="Returns due" value={String(readyDueToday.length || ordersByStatus.ready.length).padStart(2, "0")} tone="text-blue-700" />
            <MiniMetric label="Ready to charge" value={money(readyToCharge.reduce((sum, o) => sum + Number(o.total ?? 0), 0))} />
            <MiniMetric label="Blocked" value={String(blocked.length || unpaidDelivered.length).padStart(2, "0")} tone="text-red-700" />
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_280px] xl:p-5">
        <main className="min-w-0">
          {loading ? (
            <div className="flex h-60 items-center justify-center border border-[#D8D1C4] bg-[#FBFAF6]">
              <Loader2 className="h-6 w-6 animate-spin text-black/35" />
            </div>
          ) : (
            <div className="overflow-x-auto border border-[#D8D1C4] bg-[#FBFAF6]">
              <div className="grid grid-cols-1 divide-y divide-[#D8D1C4] md:min-w-[1120px] md:grid-cols-5 md:divide-x md:divide-y-0">
                {LIVE_LANES.map((lane) => (
                  <section key={lane.status} className="flex min-h-[320px] flex-col md:min-h-[620px]">
                    <div className="flex items-center justify-between border-b border-[#D8D1C4] px-3 py-3">
                      <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-black/75">{lane.title}</h2>
                      <span className="font-mono text-xs text-black/55">{liveLaneOrders[lane.status].length}</span>
                    </div>
                    <div className="flex-1 space-y-3 p-3">
                      {liveLaneOrders[lane.status].length ? liveLaneOrders[lane.status].map((order) => <OrderCard key={order.id} order={order} lane={lane} />) : (
                        <div className="border border-dashed border-[#D8D1C4] px-3 py-8 text-center text-[11px] uppercase tracking-[0.12em] text-black/35">Clear</div>
                      )}
                    </div>
                    {lane.status === "delivered" ? (
                      <button
                        type="button"
                        className="border-t border-[#D8D1C4] px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-black/50 hover:bg-white hover:text-black"
                      >
                        View history &gt;
                      </button>
                    ) : null}
                  </section>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="border border-[#D8D1C4] bg-[#FBFAF6] p-4">
              <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.14em]">
                <span>Payment Flow</span><span className="font-mono text-black/45">This week</span>
              </div>
              <div className="mt-4 grid grid-cols-4 gap-3 text-xs">
                <MiniStat label="Paid" value={money(summary.data?.revenueWeek ?? 0)} tone="bg-emerald-600" />
                <MiniStat label="Processing" value={String(ordersByStatus.processing.length)} tone="bg-blue-600" />
                <MiniStat label="Unpaid" value={money(readyToCharge.reduce((sum, o) => sum + Number(o.total ?? 0), 0))} tone="bg-amber-500" />
                <MiniStat label="Failed" value={String(blocked.length)} tone="bg-red-600" />
              </div>
            </div>
            <div className="border border-[#D8D1C4] bg-[#FBFAF6] p-4">
              <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.14em]">
                <span>Route Efficiency</span><span className="font-mono text-black/45">Today</span>
              </div>
              <div className="mt-4 grid grid-cols-4 gap-3 text-xs">
                <MiniStat label="Stops" value={String(ordersByStatus.new.length + ordersByStatus.ready.length)} />
                <MiniStat label="Pickup" value={String(ordersByStatus.new.length)} />
                <MiniStat label="Return" value={String(ordersByStatus.ready.length)} />
                <MiniStat label="Done" value={String(actionableDelivered.length)} />
              </div>
            </div>
          </div>
        </main>

        <aside className="space-y-4">
          <CommandPanel title="SELECTED ORDER">
            {selectedOrder ? (
              <SelectedOrderSummary order={selectedOrder} />
            ) : (
              <div className="text-sm text-black/45">Select an order to use Live Tools.</div>
            )}
          </CommandPanel>

          <CommandPanel title="ONE THING RIGHT NOW">
            {priority ? (
              <div className="border border-red-200 bg-red-50 p-3 text-center">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-red-700">{priority.paid ? "Due today" : "Payment open"}</div>
                <div className="mt-3 text-sm font-bold">{customerName(priority)}</div>
                <div className="font-mono text-xs text-black/55">Order #{priority.id}</div>
                <div className="mt-2 font-mono text-2xl font-semibold">{money(priority.total)}</div>
                <div className="mt-3 grid gap-2">
                  <Button className="h-8 rounded-none bg-black text-xs uppercase tracking-[0.12em] text-white hover:bg-black/80" onClick={() => { setSelectedOrderId(priority.id); openOrder(priority); }}>Open order</Button>
                  <Button variant="outline" className="h-8 rounded-none border-[#C9C0B1] bg-white text-xs uppercase tracking-[0.12em]" onClick={() => onNavigate(`/intake?orderId=${priority.id}`)}>Open intake</Button>
                  {priority.phone ? <button className="border border-[#C9C0B1] bg-white px-3 py-2 text-center text-xs font-bold uppercase tracking-[0.12em]" onClick={() => copySms(priority)}>Copy SMS</button> : null}
                </div>
              </div>
            ) : <div className="text-sm text-black/45">No critical action.</div>}
          </CommandPanel>

          <CommandPanel title="LIVE TOOLS">
            <LiveTools
              order={selectedOrder}
              updatePending={updateStatus.isPending}
              chargePending={chargeCard.isPending}
              onOpen={openOrder}
              onIntake={(order) => onNavigate(`/intake?orderId=${order.id}`)}
              onStatusAction={runNextStatusAction}
              onCharge={charge}
              onCopySms={copySms}
            />
          </CommandPanel>

          <CommandPanel title="DRIVER ACTIVE">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-[0.12em] text-black/60">Stops remaining</span>
              <span className="font-mono text-2xl font-semibold">{ordersByStatus.new.length + ordersByStatus.ready.length}</span>
            </div>
            <div className="mt-3 border-t border-[#D8D1C4] pt-3 text-xs text-black/65">
              Next: {ordersByStatus.new[0] ? `${shortBuilding(ordersByStatus.new[0])} pickup` : ordersByStatus.ready[0] ? `${shortBuilding(ordersByStatus.ready[0])} return` : "Route clear"}
            </div>
            <Button variant="outline" className="mt-3 h-8 w-full rounded-none border-[#C9C0B1] bg-white text-xs uppercase tracking-[0.12em]" onClick={() => onNavigate("/pickups")}>Open Pickups</Button>
          </CommandPanel>

          <CommandPanel title="REVENUE AT RISK">
            <div className="font-mono text-3xl font-semibold">{money(unpaidDelivered.reduce((sum, o) => sum + Number(o.total ?? 0), 0))}</div>
            <div className="mt-1 text-xs text-black/60">{unpaidDelivered.length} unpaid delivered orders</div>
            <Button className="mt-4 h-8 w-full rounded-none bg-black text-xs uppercase tracking-[0.12em] text-white hover:bg-black/80" onClick={() => onNavigate("/intake")}>Pursue failed payments</Button>
          </CommandPanel>

          <CommandPanel title="QUICK ACTIONS">
            {[
              ["New Intake", "/new-order"],
              ["Create Order", "/new-order"],
              ["Schedule Pickup", "/pickups"],
              ["Record Payment", "/intake"],
            ].map(([label, path]) => (
              <button key={label} className="flex w-full items-center justify-between border border-[#D8D1C4] bg-white px-3 py-2 text-xs font-bold uppercase tracking-[0.1em] hover:bg-black hover:text-white" onClick={() => onNavigate(path)}>
                <span>{label}</span><span>&gt;</span>
              </button>
            ))}
          </CommandPanel>
        </aside>
      </div>
    </div>
  );
}

function CommandPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border border-[#D8D1C4] bg-[#FBFAF6] p-3">
      <div className="mb-3 flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.14em]">
        <span>{title}</span><span className="font-mono text-black/40">...</span>
      </div>
      {children}
    </section>
  );
}

function SelectedOrderSummary({ order }: { order: Order }) {
  const hasCard = !!(order.stripeCustomerId || order.stripePaymentMethodId);
  return (
    <div className="space-y-3 text-xs">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-black/45">Active order</div>
        <div className="mt-1 text-sm font-bold uppercase tracking-[0.08em]">{customerName(order)}</div>
        <div className="font-mono text-black/55">#LB-{order.id} / {order.status}</div>
      </div>
      <div className="grid gap-2 border-t border-[#D8D1C4] pt-3 uppercase tracking-[0.08em] text-black/65">
        <div>{shortBuilding(order)} {order.unit ? `/ UNIT ${order.unit}` : ""}</div>
        <div>{serviceLabel(order.serviceType)}</div>
        <div>Pickup {order.pickupDate} / {order.pickupTimeWindow || "window n/a"}</div>
        <div>Return {order.deliveryDate || "not set"} / {order.deliveryTimeWindow || "window n/a"}</div>
        <div className={statusTone(order)}>{order.paid ? "Paid" : hasCard ? "Card on file" : "Payment needs intake"} / {money(order.total)}</div>
      </div>
    </div>
  );
}

function LiveTools({
  order,
  updatePending,
  chargePending,
  onOpen,
  onIntake,
  onStatusAction,
  onCharge,
  onCopySms,
}: {
  order: Order | null;
  updatePending: boolean;
  chargePending: boolean;
  onOpen: (order: Order) => void;
  onIntake: (order: Order) => void;
  onStatusAction: (order: Order) => void;
  onCharge: (order: Order) => void;
  onCopySms: (order: Order) => void;
}) {
  if (!order) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-black/45">Select an order to use Live Tools.</p>
        {["View", "Intake", "Process", "Ready", "Deliver", "Text"].map((label) => (
          <button key={label} className="flex w-full items-center justify-between border border-[#D8D1C4] bg-white px-3 py-2 text-xs font-bold uppercase tracking-[0.1em] opacity-40" disabled>
            <span>{label}</span><span>&gt;</span>
          </button>
        ))}
      </div>
    );
  }

  const nextStatus = nextLiveStatus(order);
  const hasCard = !!(order.stripeCustomerId || order.stripePaymentMethodId);
  const canCharge = order.status === "delivered" && hasCard && amountCents(order) >= 50 && !order.paid;

  return (
    <div className="space-y-2">
      <button className="flex w-full items-center justify-between border border-[#D8D1C4] bg-white px-3 py-2 text-xs font-bold uppercase tracking-[0.1em] hover:bg-black hover:text-white" onClick={() => onOpen(order)}>
        <span>View</span><span>&gt;</span>
      </button>
      <button className="flex w-full items-center justify-between border border-[#D8D1C4] bg-white px-3 py-2 text-xs font-bold uppercase tracking-[0.1em] hover:bg-black hover:text-white" onClick={() => onIntake(order)}>
        <span>{order.status === "delivered" ? "Payment / Intake" : "Intake"}</span><span>&gt;</span>
      </button>
      {nextStatus ? (
        <button className="flex w-full items-center justify-between border border-black bg-black px-3 py-2 text-xs font-bold uppercase tracking-[0.1em] text-white hover:bg-black/80 disabled:opacity-50" disabled={updatePending} onClick={() => onStatusAction(order)}>
          <span>{nextLiveActionLabel(order)}</span><span>{nextStatus}</span>
        </button>
      ) : (
        <button className="flex w-full items-center justify-between border border-[#D8D1C4] bg-white px-3 py-2 text-xs font-bold uppercase tracking-[0.1em] hover:bg-black hover:text-white disabled:opacity-50" disabled={chargePending} onClick={() => onCharge(order)}>
          <span>{canCharge ? "Charge card" : "Open payment"}</span><span>&gt;</span>
        </button>
      )}
      {order.phone ? (
        <a className="flex w-full items-center justify-between border border-[#D8D1C4] bg-white px-3 py-2 text-xs font-bold uppercase tracking-[0.1em] hover:bg-black hover:text-white" href={phoneHref(order.phone)}>
          <span>Text</span><span>&gt;</span>
        </a>
      ) : (
        <button className="flex w-full items-center justify-between border border-[#D8D1C4] bg-white px-3 py-2 text-xs font-bold uppercase tracking-[0.1em] opacity-40" disabled>
          <span>Text unavailable</span><span>&gt;</span>
        </button>
      )}
      <button className="flex w-full items-center justify-between border border-[#D8D1C4] bg-white px-3 py-2 text-xs font-bold uppercase tracking-[0.1em] hover:bg-black hover:text-white" onClick={() => onCopySms(order)}>
        <span>Copy SMS</span><span>&gt;</span>
      </button>
    </div>
  );
}

function MiniStat({ label, value, tone = "bg-black" }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className={`mb-2 h-2 w-2 ${tone}`} />
      <div className="text-[11px] uppercase tracking-[0.12em] text-black/55">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}
