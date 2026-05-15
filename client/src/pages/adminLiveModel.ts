import type { Order } from "@shared/types";

export type LiveStatus = "new" | "collected" | "processing" | "ready" | "delivered";

export const LIVE_LANES: Array<{
  title: string;
  status: LiveStatus;
  rail: string;
  next?: LiveStatus;
  nextLabel?: string;
}> = [
  { title: "NEW INTAKE", status: "new", rail: "bg-emerald-600" },
  { title: "PICKUP READY", status: "collected", rail: "bg-blue-600", next: "processing", nextLabel: "Process" },
  { title: "IN CLEANING", status: "processing", rail: "bg-blue-500", next: "ready", nextLabel: "Ready" },
  { title: "RETURN READY", status: "ready", rail: "bg-emerald-600", next: "delivered", nextLabel: "Deliver" },
  { title: "DELIVERED / CHARGE", status: "delivered", rail: "bg-emerald-700" },
];

export function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function money(value: unknown) {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function amountCents(order: Pick<Order, "total">) {
  return Math.round(Number(order.total ?? 0) * 100);
}

export function customerName(order: Pick<Order, "firstName" | "lastName">) {
  return `${order.firstName ?? ""} ${order.lastName ?? ""}`.trim() || "Unknown customer";
}

export function serviceLabel(serviceType: Order["serviceType"]) {
  return serviceType === "dry_cleaning" ? "Dry cleaning" : "Wash & fold";
}

export function shortBuilding(order: Pick<Order, "buildingSlug" | "address">) {
  return (order.buildingSlug || order.address || "Building").replace(/[-_]/g, " ").toUpperCase();
}

export function phoneHref(phone: string) {
  const digits = phone.replace(/[^\d+]/g, "");
  if (!digits) return "";
  return `sms:${digits.startsWith("+") ? digits : `+1${digits.replace(/^1/, "")}`}`;
}

export function isToday(date?: string | null) {
  return !!date && date === todayYmd();
}

export function isActionableDelivered(order: Order) {
  const hasPositiveTotal = amountCents(order) >= 50;
  return !order.paid || (!order.paid && hasPositiveTotal) || isToday(order.deliveryDate);
}

export function olderThan24Hours(date: Date | string | null | undefined) {
  if (!date) return false;
  return Date.now() - new Date(date).getTime() > 24 * 60 * 60 * 1000;
}

export function statusTone(order: Pick<Order, "status" | "paid">) {
  if (order.status === "delivered" && !order.paid) return "text-red-700";
  if (order.paid) return "text-emerald-700";
  if (order.status === "collected" || order.status === "processing") return "text-blue-700";
  return "text-black/60";
}

export function nextLiveStatus(order: Pick<Order, "status">): LiveStatus | null {
  if (order.status === "collected") return "processing";
  if (order.status === "processing") return "ready";
  if (order.status === "ready") return "delivered";
  return null;
}

export function nextLiveActionLabel(order: Pick<Order, "status">): string {
  if (order.status === "new") return "Dispatch Driver";
  if (order.status === "collected") return "Process";
  if (order.status === "processing") return "Ready";
  if (order.status === "ready") return "Deliver";
  return "Open payment";
}

export function syncSelectedOrder(selectedOrderId: number | null, orders: Order[]): Order | null {
  if (!selectedOrderId) return null;
  return orders.find((order) => order.id === selectedOrderId) ?? null;
}

export function pickOneThingRightNow(input: {
  unpaidDelivered: Order[];
  readyDueToday: Order[];
  newOrders: Order[];
  staleCollectedOrProcessing: Order[];
  blocked: Order[];
}): Order | null {
  return (
    input.unpaidDelivered[0] ??
    input.readyDueToday[0] ??
    input.newOrders[0] ??
    input.staleCollectedOrProcessing[0] ??
    input.blocked[0] ??
    null
  );
}
