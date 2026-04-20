import type { Order } from "@shared/types";
import { BUILDINGS, matchBuilding } from "@shared/buildings";

export type DriverMissionStop = {
  id: string;
  orderId: number;
  stage: "pickup" | "delivery";
  status: Order["status"];
  customerName: string;
  address: string;
  unit: string | null;
  mapsUrl: string;
  actionLabel: string;
  nextStatus: "collected" | "delivered";
  buildingName: string | null;
  dateLabel: string;
  timeWindow: string;
};

export type MissionTarget = {
  kind: "real" | "fallback";
  label: string;
  address: string | null;
  mapsUrl: string | null;
  intel: string;
  customerName: string | null;
  buildingName: string | null;
  orderId: number | null;
  nextStatus: "collected" | "delivered" | null;
};

function computeDeliveryDate(pickupDate: string): string {
  const [y, m, d] = pickupDate.split("-").map(Number);
  const next = new Date(y, m - 1, d + 1);
  return [
    next.getFullYear(),
    String(next.getMonth() + 1).padStart(2, "0"),
    String(next.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatPickupDate(dateStr: string): string {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function buildStop(order: Order, stage: "pickup" | "delivery"): DriverMissionStop {
  const building = matchBuilding(order.address);
  return {
    id: `${stage}-${order.id}`,
    orderId: order.id,
    stage,
    status: order.status,
    customerName: `${order.firstName} ${order.lastName}`,
    address: order.address,
    unit: order.unit ?? null,
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.address + (order.unit ? `, Unit ${order.unit}` : ""))}`,
    actionLabel: stage === "pickup" ? "Mark Picked Up" : "Mark Delivered",
    nextStatus: stage === "pickup" ? "collected" : "delivered",
    buildingName: building?.name ?? null,
    dateLabel:
      stage === "pickup"
        ? formatPickupDate(order.pickupDate)
        : formatPickupDate(computeDeliveryDate(order.pickupDate)),
    timeWindow: order.pickupTimeWindow,
  };
}

export function buildDriverMissionStops(
  pickups: Order[] | undefined,
  deliveries: Order[] | undefined
): DriverMissionStop[] {
  const pickupStops = (pickups ?? []).map((order) => buildStop(order, "pickup"));
  const deliveryStops = (deliveries ?? []).map((order) => buildStop(order, "delivery"));
  return [...pickupStops, ...deliveryStops];
}

function resolveFallbackTarget(
  missionNumber: number,
  payloadIndex: number
): MissionTarget {
  const fallbackBuilding = BUILDINGS[(missionNumber + payloadIndex - 1) % BUILDINGS.length];
  const address = fallbackBuilding?.defaultAddress ?? null;
  return {
    kind: "fallback",
    label: address ?? `Fallback Sector ${missionNumber}-${payloadIndex}`,
    address,
    mapsUrl: null,
    intel: address
      ? `ADDR: ${address} // TARGET SCORE: HIGH-DENSITY`
      : `SECTOR ${missionNumber}-${payloadIndex} // MANUAL TARGETING REQUIRED`,
    customerName: null,
    buildingName: fallbackBuilding?.name ?? null,
    orderId: null,
    nextStatus: null,
  };
}

export function deriveMissionTarget(
  stops: DriverMissionStop[],
  resolvedOrderIds: number[],
  missionNumber: number,
  payloadIndex: number
): MissionTarget {
  const nextRealStop = stops.find(
    (stop) => !resolvedOrderIds.includes(stop.orderId)
  );
  if (!nextRealStop) {
    return resolveFallbackTarget(missionNumber, payloadIndex);
  }

  return {
    kind: "real",
    label: nextRealStop.address,
    address: nextRealStop.address,
    mapsUrl: nextRealStop.mapsUrl,
    intel: nextRealStop.buildingName
      ? `${nextRealStop.buildingName} // ${nextRealStop.dateLabel} // ${nextRealStop.timeWindow}`
      : `${nextRealStop.dateLabel} // ${nextRealStop.timeWindow}`,
    customerName: nextRealStop.customerName,
    buildingName: nextRealStop.buildingName,
    orderId: nextRealStop.orderId,
    nextStatus: nextRealStop.nextStatus,
  };
}
