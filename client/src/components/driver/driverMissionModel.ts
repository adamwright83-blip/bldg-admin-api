import type { Order } from "@shared/types";
import { matchBuilding } from "@shared/buildings";

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
  buildingSlug: string | null;
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

type TargetZone = "midwilshire" | "downtown" | "westla";

type ResidentialTargetCandidate = {
  id: string;
  label: string;
  address: string;
  zones: TargetZone[];
  intel: string;
};

const TARGET_CANDIDATES: ResidentialTargetCandidate[] = [
  {
    id: "figueroa-950",
    label: "950 S Figueroa Residential Cluster",
    address: "950 S Figueroa St, Los Angeles, CA 90015",
    zones: ["downtown", "midwilshire"],
    intel: "RESIDENTIAL CLUSTER // HIGH FOOT-TRAFFIC LOBBY // MULTIFAMILY DENSITY",
  },
  {
    id: "hill-939",
    label: "939 S Hill Residential Cluster",
    address: "939 S Hill St, Los Angeles, CA 90015",
    zones: ["downtown"],
    intel: "APARTMENT COMPLEX // STREET-LEVEL ACCESS // HIGH DENSITY",
  },
  {
    id: "olive-888",
    label: "888 S Olive Residential Cluster",
    address: "888 S Olive St, Los Angeles, CA 90014",
    zones: ["downtown"],
    intel: "MULTIFAMILY TOWER // DOOR-TO-DOOR SATURATION CANDIDATE",
  },
  {
    id: "new-hampshire-744",
    label: "744 S New Hampshire Residential Cluster",
    address: "744 S New Hampshire Ave, Los Angeles, CA 90005",
    zones: ["midwilshire"],
    intel: "MID-WILSHIRE APARTMENT BAND // RESIDENTIAL CORRIDOR",
  },
  {
    id: "james-m-wood-2848",
    label: "2848 James M Wood Residential Cluster",
    address: "2848 James M Wood Blvd, Los Angeles, CA 90006",
    zones: ["midwilshire"],
    intel: "MULTIFAMILY BLOCK // WALKABLE DELIVERY LANE // NON-SERVICED",
  },
  {
    id: "burlington-734",
    label: "734 S Burlington Residential Cluster",
    address: "734 S Burlington Ave, Los Angeles, CA 90057",
    zones: ["midwilshire", "downtown"],
    intel: "RESIDENTIAL COURTYARD CLUSTER // WESTLAKE EDGE",
  },
  {
    id: "leconte-10995",
    label: "10995 Le Conte Residential Cluster",
    address: "10995 Le Conte Ave, Los Angeles, CA 90024",
    zones: ["westla"],
    intel: "WESTSIDE RESIDENTIAL TOWER BAND // STUDENT + APARTMENT MIX",
  },
  {
    id: "roebling-10982",
    label: "10982 Roebling Residential Cluster",
    address: "10982 Roebling Ave, Los Angeles, CA 90024",
    zones: ["westla"],
    intel: "MULTIFAMILY WALK-UP CLUSTER // NON-SERVICED WEST LA",
  },
  {
    id: "glendon-1843",
    label: "1843 Glendon Residential Cluster",
    address: "1843 Glendon Ave, Los Angeles, CA 90025",
    zones: ["westla"],
    intel: "SAWTELLE-ADJACENT APARTMENT CORRIDOR // TARGET SCORE HIGH",
  },
];

const BLOCKED_BUILDING_SLUGS = new Set(["centuryparkeast", "opusla"]);
const BLOCKED_ADDRESS_PATTERNS = [
  "century park e",
  "century park east",
  "opus los angeles",
  "3545 wilshire",
  "3650 6th",
];

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

function normalizeAddress(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\da-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clusterKeyFromAddress(address: string): string {
  const normalized = normalizeAddress(address);
  return normalized.split(",")[0]?.trim() || normalized;
}

function inferTargetZone(address: string | null | undefined): TargetZone {
  const normalized = normalizeAddress(address ?? "");
  if (
    normalized.includes("century park") ||
    normalized.includes("avenue of the stars") ||
    normalized.includes("westwood") ||
    normalized.includes("roebling") ||
    normalized.includes("glendon") ||
    normalized.includes("le conte")
  ) {
    return "westla";
  }

  if (
    normalized.includes("figueroa") ||
    normalized.includes("olive") ||
    normalized.includes("hill st") ||
    normalized.includes("downtown") ||
    normalized.includes("broadway")
  ) {
    return "downtown";
  }

  return "midwilshire";
}

function isBlockedServicedAddress(address: string): boolean {
  const normalized = normalizeAddress(address);
  if (BLOCKED_ADDRESS_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return true;
  }
  const matched = matchBuilding(address);
  return matched ? BLOCKED_BUILDING_SLUGS.has(matched.slug) : false;
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
    buildingSlug: building?.slug ?? null,
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

export function deriveResolutionStop(
  stops: DriverMissionStop[],
  resolvedOrderIds: number[]
): DriverMissionStop | null {
  return (
    stops.find((stop) => !resolvedOrderIds.includes(stop.orderId)) ?? null
  );
}

function resolveFallbackTarget(
  missionNumber: number,
  payloadIndex: number
): MissionTarget {
  return {
    kind: "fallback",
    label: `Fallback Sector ${missionNumber}-${payloadIndex}`,
    address: null,
    mapsUrl: null,
    intel: "MANUAL TARGETING REQUIRED // NON-SERVICED CLUSTER NOT RESOLVED",
    customerName: null,
    buildingName: null,
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
  const resolutionStop = deriveResolutionStop(stops, resolvedOrderIds);
  const anchorZone = inferTargetZone(resolutionStop?.address ?? stops[0]?.address ?? null);

  const servicedClusterKeys = new Set<string>();
  for (const stop of stops) {
    servicedClusterKeys.add(clusterKeyFromAddress(stop.address));
    if (stop.buildingSlug && BLOCKED_BUILDING_SLUGS.has(stop.buildingSlug)) {
      servicedClusterKeys.add(stop.buildingSlug);
    }
  }

  const filteredCandidates = TARGET_CANDIDATES.filter((candidate) => {
    if (isBlockedServicedAddress(candidate.address)) return false;
    const clusterKey = clusterKeyFromAddress(candidate.address);
    if (servicedClusterKeys.has(clusterKey)) return false;
    return true;
  });

  const zoneMatchedCandidates = filteredCandidates.filter((candidate) =>
    candidate.zones.includes(anchorZone)
  );
  const candidatePool =
    zoneMatchedCandidates.length > 0 ? zoneMatchedCandidates : filteredCandidates;

  if (!candidatePool.length) {
    return resolveFallbackTarget(missionNumber, payloadIndex);
  }

  const index = (missionNumber + payloadIndex - 2) % candidatePool.length;
  const candidate = candidatePool[index];

  return {
    kind: "real",
    label: candidate.label,
    address: candidate.address,
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(candidate.address)}`,
    intel: resolutionStop
      ? `${candidate.intel} // NEAR ACTIVE STOP ${resolutionStop.dateLabel}`
      : candidate.intel,
    customerName: null,
    buildingName: candidate.label,
    orderId: null,
    nextStatus: null,
  };
}
