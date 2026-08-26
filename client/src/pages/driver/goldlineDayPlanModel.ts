import type { Order } from "@shared/types";
import type { CommercialMission } from "@shared/commercialMission";
import type { ExternalOperationalOrder } from "@shared/externalOperationalOrder";
import { formatExternalWindow } from "@shared/externalOperationalOrder";
import type {
  OpenChannelMission,
  OpenChannelTask,
} from "../../../../server/openChannel/openChannelTypes";
import { detectOpenChannelGap } from "./goldlineDriverModel";

export type DayPlanStopKind = "pickup" | "dropoff" | "sales" | "prep";
export type DayPlanSource =
  | "laundry_butler"
  | "cleancloud"
  | "open_channel"
  | "commercial_mission";

export type DayPlanStop = {
  id: string;
  kind: DayPlanStopKind;
  title: string;
  source: DayPlanSource;
  sourceLabel: string;
  timeLabel: string;
  sortKey: string;
  estimatedMinutes: number | null;
  status: "upcoming" | "ready" | "completed" | "cancelled";
  fixed: boolean;
  address: string | null;
  navigationUrl: string | null;
  missionTarget: "colosseum" | null;
  completedAt: string | null;
};

export type DayPlanProjection = {
  businessDate: string;
  stops: DayPlanStop[];
  counts: Record<DayPlanStopKind, number>;
  fixedWindowCount: number;
  cleanCloudCount: number;
};

function nameForOrder(order: Order): string {
  return (
    `${order.firstName ?? ""} ${order.lastName ?? ""}`.trim() ||
    order.address ||
    `Order #${order.id}`
  );
}

function navigationUrl(address: string | null | undefined): string | null {
  return address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
    : null;
}

function timeSortKey(
  value: string | null | undefined,
  fallback: string
): string {
  const match = value?.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!match) return fallback;
  let hour = Number(match[1]);
  const suffix = match[3]?.toUpperCase();
  if (suffix === "PM" && hour < 12) hour += 12;
  if (suffix === "AM" && hour === 12) hour = 0;
  // Driver routes use the familiar compact labels from operations ("1:30–2:30")
  // without an AM/PM suffix. Morning commitments are conventionally 7–11;
  // compact 1–6 windows are afternoon commitments.
  if (!suffix && hour >= 1 && hour <= 6) hour += 12;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

function nativeStop(order: Order, kind: "pickup" | "dropoff"): DayPlanStop {
  const window =
    (kind === "pickup" ? order.pickupTimeWindow : order.deliveryTimeWindow) ||
    "Time TBD";
  const completed =
    kind === "pickup"
      ? ["collected", "processing", "ready", "delivered"].includes(order.status)
      : order.status === "delivered";
  return {
    id: `native-${kind}-${order.id}`,
    kind,
    title: nameForOrder(order),
    source: "laundry_butler",
    sourceLabel: "Laundry Butler",
    timeLabel: window,
    sortKey: timeSortKey(window, "60:00"),
    estimatedMinutes: null,
    status: completed ? "completed" : "upcoming",
    fixed: window !== "Time TBD",
    address: order.address || null,
    navigationUrl: navigationUrl(order.address),
    missionTarget: null,
    completedAt: completed ? String(order.updatedAt ?? "") || null : null,
  };
}

function externalStop(order: ExternalOperationalOrder): DayPlanStop | null {
  if (order.reviewState !== "confirmed") return null;
  const time =
    formatExternalWindow(order.windowStart, order.windowEnd) ?? "Time TBD";
  return {
    id: `external-${order.id}`,
    kind: order.jobKind,
    title: order.customerName,
    source: "cleancloud",
    sourceLabel:
      order.sourceSystem === "cleancloud" ? "CleanCloud" : "External",
    timeLabel: time,
    sortKey: timeSortKey(order.windowStart, "60:00"),
    estimatedMinutes: null,
    status:
      order.operationalStatus === "completed"
        ? "completed"
        : order.operationalStatus === "cancelled"
          ? "cancelled"
          : "upcoming",
    fixed: Boolean(order.windowStart || order.windowEnd),
    address: order.address,
    navigationUrl: navigationUrl(order.address),
    missionTarget: null,
    completedAt: order.completedAt,
  };
}

function openChannelStop(
  task: OpenChannelTask,
  mission: OpenChannelMission
): DayPlanStop {
  const kind: DayPlanStopKind = task.category === "sales" ? "sales" : "prep";
  return {
    id: `open-channel-${mission.id}-${task.id}`,
    kind,
    title: task.title,
    source: "open_channel",
    sourceLabel: "Daily briefing",
    timeLabel: `${task.estimatedMinutes} min`,
    sortKey: `80:${String(task.position).padStart(3, "0")}`,
    estimatedMinutes: task.estimatedMinutes,
    status: task.status === "completed" ? "completed" : "upcoming",
    fixed: false,
    address: task.navigationQuery,
    navigationUrl: navigationUrl(task.navigationQuery),
    missionTarget: null,
    completedAt: task.completedAt,
  };
}

function commercialStop(
  mission: CommercialMission,
  ready: boolean
): DayPlanStop {
  const step = mission.steps.find(
    item => item.status === "active" || item.status === "ready"
  );
  const complete = [
    "game_completed",
    "visit_completed",
    "won",
    "lost",
  ].includes(mission.status);
  const deadline = step?.deadlineAt ?? mission.expiresAt;
  return {
    id: `commercial-${mission.id}`,
    kind: "sales",
    title: mission.account.name,
    source: "commercial_mission",
    sourceLabel: mission.code,
    timeLabel: deadline
      ? `By ${new Date(deadline).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
      : "Flexible window",
    sortKey: deadline ?? `70:${String(mission.id).padStart(8, "0")}`,
    estimatedMinutes: null,
    status: complete ? "completed" : ready ? "ready" : "upcoming",
    fixed: Boolean(deadline),
    address: step?.destinationAddress ?? mission.account.address ?? null,
    navigationUrl:
      step?.mapsUrl ??
      navigationUrl(step?.destinationAddress ?? mission.account.address),
    missionTarget: /greystar/i.test(mission.account.name) ? "colosseum" : null,
    completedAt: mission.completedAt,
  };
}

export function buildDayPlanProjection(input: {
  businessDate: string;
  pickups?: Order[];
  deliveries?: Order[];
  externalOrders?: ExternalOperationalOrder[];
  openChannelMission?: OpenChannelMission | null;
  salesMissions?: CommercialMission[];
  now?: Date;
  nextCommitmentAt?: string | null;
}): DayPlanProjection {
  const fixedCount = [
    ...(input.pickups ?? []),
    ...(input.deliveries ?? []),
  ].filter(order =>
    Boolean(order.pickupTimeWindow || order.deliveryTimeWindow)
  ).length;
  const gap = detectOpenChannelGap({
    now: input.now ?? new Date(),
    selectedDate: input.businessDate,
    nextCommitmentAt: input.nextCommitmentAt,
    fixedStopCount: fixedCount,
    hasMission: false,
  });
  const seen = new Set<string>();
  const unique = (stop: DayPlanStop) => {
    if (seen.has(stop.id)) return false;
    seen.add(stop.id);
    return true;
  };
  const stops = [
    ...(input.pickups ?? []).map(order => nativeStop(order, "pickup")),
    ...(input.deliveries ?? []).map(order => nativeStop(order, "dropoff")),
    ...(input.externalOrders ?? [])
      .map(externalStop)
      .filter((item): item is DayPlanStop => Boolean(item)),
    ...(input.openChannelMission?.status === "active"
      ? input.openChannelMission.tasks.map(task =>
          openChannelStop(task, input.openChannelMission!)
        )
      : []),
    ...(input.salesMissions ?? []).map(mission =>
      commercialStop(
        mission,
        gap.available &&
          [
            "game_ready",
            "game_active",
            "preparing",
            "en_route",
            "arrived",
          ].includes(mission.status)
      )
    ),
  ]
    .filter(unique)
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  const counts = { pickup: 0, dropoff: 0, sales: 0, prep: 0 };
  for (const stop of stops) counts[stop.kind] += 1;
  return {
    businessDate: input.businessDate,
    stops,
    counts,
    fixedWindowCount: stops.filter(stop => stop.fixed).length,
    cleanCloudCount: stops.filter(stop => stop.source === "cleancloud").length,
  };
}
