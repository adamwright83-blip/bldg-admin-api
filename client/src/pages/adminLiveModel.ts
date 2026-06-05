import type { Order } from "@shared/types";

export type LiveStatus = "intake-pending" | "new" | "collected" | "processing" | "ready" | "delivered";
export type LiveOrderSource = "HELD" | "admin" | "driver" | "unknown";

export type LiveOrderGroup = {
  key: string;
  orders: Order[];
  representative: Order;
  isLikelyDuplicate: boolean;
};

export const LIVE_LANES: Array<{
  title: string;
  status: LiveStatus;
  rail: string;
  next?: LiveStatus;
  nextLabel?: string;
}> = [
  { title: "HELD REVIEW", status: "intake-pending", rail: "bg-amber-500", next: "new", nextLabel: "Accept / Schedule" },
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

export function liveDateLabel(value?: string | null) {
  return value || "not set";
}

export function serviceLabel(serviceType: Order["serviceType"]) {
  return serviceType === "dry_cleaning" ? "Dry cleaning" : "Wash & fold";
}

export function shortBuilding(order: Pick<Order, "buildingSlug" | "address">) {
  return (order.buildingSlug || order.address || "Building").replace(/[-_]/g, " ").toUpperCase();
}

function normalizedText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizedPhone(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

function normalizedDate(value: unknown) {
  return String(value ?? "not-set").slice(0, 10) || "not-set";
}

function duplicateRequestSignal(order: Order) {
  return normalizedText(
    order.heldCleanedRequestText ||
      order.heldRawRequestText ||
      order.specialInstructions ||
      ""
  ).slice(0, 120);
}

export function liveOrderSource(order: Order): LiveOrderSource {
  if (order.heldSource || order.heldRawRequestText || order.heldCleanedRequestText) return "HELD";
  if (order.status === "collected" || order.status === "delivered") return "driver";
  if (order.createdAt) return "admin";
  return "unknown";
}

export function liveOrderCreatedLabel(value: Order["createdAt"]) {
  if (!value) return "created time unknown";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "created time unknown";
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function duplicateGroupKey(order: Order) {
  const identity = order.bldgUserId
    ? `u:${order.bldgUserId}`
    : normalizedPhone(order.phone)
      ? `p:${normalizedPhone(order.phone)}`
      : `n:${normalizedText(customerName(order))}`;
  return [
    identity,
    order.status,
    order.serviceType,
    normalizedDate(order.pickupDate),
    normalizedDate(order.deliveryDate),
    normalizedText(order.buildingSlug || order.address),
    normalizedText(order.unit),
    duplicateRequestSignal(order),
  ].join("|");
}

export function groupLikelyDuplicateLiveOrders(orders: Order[]): LiveOrderGroup[] {
  const map = new Map<string, Order[]>();
  for (const order of orders) {
    const key = duplicateGroupKey(order);
    map.set(key, [...(map.get(key) ?? []), order]);
  }

  return [...map.entries()]
    .map(([key, groupedOrders]) => {
      const sorted = [...groupedOrders].sort((a, b) => {
        const createdDelta = new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
        return createdDelta || b.id - a.id;
      });
      return {
        key,
        orders: sorted,
        representative: sorted[0],
        isLikelyDuplicate: sorted.length > 1,
      };
    })
    .sort((a, b) => {
      const createdDelta =
        new Date(b.representative.createdAt ?? 0).getTime() -
        new Date(a.representative.createdAt ?? 0).getTime();
      return createdDelta || b.representative.id - a.representative.id;
    });
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
  if (order.status === "intake-pending") return "text-amber-700";
  if (order.status === "collected" || order.status === "processing") return "text-blue-700";
  return "text-black/60";
}

export function nextLiveStatus(order: Pick<Order, "status">): LiveStatus | null {
  if (order.status === "intake-pending") return "new";
  if (order.status === "collected") return "processing";
  if (order.status === "processing") return "ready";
  if (order.status === "ready") return "delivered";
  return null;
}

export function nextLiveActionLabel(order: Pick<Order, "status">): string {
  if (order.status === "intake-pending") return "Accept / Schedule";
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
  heldReviewOrders?: Order[];
  unpaidDelivered: Order[];
  readyDueToday: Order[];
  newOrders: Order[];
  staleCollectedOrProcessing: Order[];
  blocked: Order[];
}): Order | null {
  return (
    input.heldReviewOrders?.[0] ??
    input.unpaidDelivered[0] ??
    input.readyDueToday[0] ??
    input.newOrders[0] ??
    input.staleCollectedOrProcessing[0] ??
    input.blocked[0] ??
    null
  );
}
