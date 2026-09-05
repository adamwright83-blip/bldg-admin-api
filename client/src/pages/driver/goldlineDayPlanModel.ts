import type { Order } from "@shared/types";
import type { CommercialMission } from "@shared/commercialMission";
import type { ExternalOperationalOrder } from "@shared/externalOperationalOrder";
import { formatExternalWindow } from "@shared/externalOperationalOrder";
import type {
  OpenChannelMission,
  OpenChannelTask,
} from "../../../../server/openChannel/openChannelTypes";
import { detectOpenChannelGap } from "./goldlineDriverModel";
import type {
  DayDirectorCommitment,
  ProcessingLocation,
} from "@shared/dayDirector";
import { compileGoldlineAdventure, type TerritoryBundleHint } from "@shared/goldlineAdventure";
import { projectStopsOntoCampaign } from "@shared/goldlineCampaignRuntime";

export type LiveAdventureObjective = {
  id: string;
  kind: "sales" | "growth";
  title: string;
  sourceLabel: string;
  dueAt: string | null;
  status: "ready" | "completed" | "blocked";
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  /** The building this objective belongs to, when Goldline already knows it. */
  physicalEntityId: string | null;
  explanation: string;
  sourceEvidenceReference: string;
  sourceOccurredAt: string | null;
};

/** The parts of a field-today item this projection is allowed to read. */
type FieldTodaySource = {
  id: string;
  kind: string;
  title: string;
  subtitle: string;
  status: string;
  urgency: string;
  scheduledAt: string | null;
  destination: { address: string; latitude: number | null; longitude: number | null } | null;
  physicalEntityId?: string | null;
  whySurfaced?: string | null;
  whySourceOccurredAt?: string | null;
  source: { sourceReference: string };
};

const LIVE_OBJECTIVE_KINDS = [
  "follow_up",
  "mission_dispatch",
  "customer_recovery",
  "contextual_move",
  "commercial_visit",
  "field_commitment",
  "reported_opportunity",
];

const LIVE_OBJECTIVE_SOURCE_LABELS: Record<string, string> = {
  customer_recovery: "Dormant relationship",
  contextual_move: "Field discovery",
  field_commitment: "Field promise",
  reported_opportunity: "Field signal",
};

/**
 * The authoritative day, as objectives the world can host.
 *
 * This only reshapes work that already exists in the field-today projection —
 * real pickups, deliveries, commitments, recoveries and discoveries. It creates
 * no objective of its own, so an empty day stays an empty day rather than being
 * padded with invented things to do.
 */
export function liveObjectivesFromFieldToday(
  timeline: FieldTodaySource[]
): LiveAdventureObjective[] {
  return timeline
    .filter(item => LIVE_OBJECTIVE_KINDS.includes(item.kind))
    .map(item => ({
      id: item.id,
      kind:
        item.kind === "customer_recovery" || item.kind === "contextual_move"
          ? ("growth" as const)
          : ("sales" as const),
      title: item.title,
      sourceLabel:
        LIVE_OBJECTIVE_SOURCE_LABELS[item.kind] ?? "Commercial commitment",
      dueAt: item.scheduledAt,
      status:
        item.status === "completed" ||
        item.status === "recovered" ||
        item.status === "published"
          ? ("completed" as const)
          : item.urgency === "blocked"
            ? ("blocked" as const)
            : ("ready" as const),
      address: item.destination?.address ?? null,
      latitude: item.destination?.latitude ?? null,
      longitude: item.destination?.longitude ?? null,
      physicalEntityId: item.physicalEntityId ?? null,
      explanation: item.whySurfaced ?? item.subtitle,
      sourceEvidenceReference: item.source.sourceReference,
      sourceOccurredAt: item.whySourceOccurredAt ?? null,
    }));
}

export type DayPlanStopKind =
  | "pickup"
  | "dropoff"
  | "sales"
  | "prep"
  | "processing"
  | "growth";
export type DayPlanSource =
  | "laundry_butler"
  | "cleancloud"
  | "open_channel"
  | "commercial_mission"
  | "derived_operation"
  | "user_commitment"
  | "living_world";

export type DayPlanStop = {
  /** Exact source identifiers for the existing write services. Never infer a
   * mutation from a title or from completion of a fictional encounter. */
  action?:
    | { type: "order"; orderId: number; status: "collected" | "delivered"; eligible: boolean }
    | { type: "external"; id: string }
    | { type: "task"; missionId: string; taskId: string }
    | { type: "commitment"; id: string }
    | { type: "commercial"; missionId: number };
  id: string;
  kind: DayPlanStopKind;
  title: string;
  source: DayPlanSource;
  sourceLabel: string;
  timeLabel: string;
  sortKey: string;
  estimatedMinutes: number | null;
  status: "upcoming" | "ready" | "blocked" | "completed" | "cancelled";
  fixed: boolean;
  address: string | null;
  /**
   * Real verified coordinates only. Most laundry orders carry an address with
   * no geocode, so these stay null rather than being estimated from the text.
   */
  latitude?: number | null;
  longitude?: number | null;
  /** The building this stop belongs to, when Goldline already knows it. */
  physicalEntityId?: string | null;
  navigationUrl: string | null;
  missionTarget: "colosseum" | null;
  completedAt: string | null;
  /** Human-readable reason/evidence for carried-forward world pressure. */
  whySurfaced?: string | null;
  sourceEvidenceReference?: string | null;
  sourceOccurredAt?: string | null;
};

export type DayPlanProjection = {
  businessDate: string;
  stops: DayPlanStop[];
  counts: Record<DayPlanStopKind, number>;
  fixedWindowCount: number;
  cleanCloudCount: number;
  growthCoverage: "covered" | "underfilled" | "blocked" | "unknown";
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
    action: { type: "order", orderId: order.id, status: kind === "pickup" ? "collected" : "delivered", eligible: kind === "pickup" || Boolean(order.paid) },
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
    action: { type: "external", id: order.id },
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
    action: { type: "task", missionId: mission.id, taskId: task.id },
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
    action: { type: "commercial", missionId: mission.id },
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
  processingLocation?: ProcessingLocation | null;
  commitments?: DayDirectorCommitment[];
  physicalVisitBlocked?: boolean;
  liveObjectives?: LiveAdventureObjective[];
  territoryBundles?: TerritoryBundleHint[];
  campaignChapters?: Array<{ objectiveIds: readonly string[] }>;
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
  const baseStops = [
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
    ...(input.salesMissions ?? []).flatMap(mission => {
      const primary = commercialStop(
        mission,
        gap.available &&
          [
            "game_ready",
            "game_active",
            "preparing",
            "en_route",
            "arrived",
          ].includes(mission.status)
      );
      if (
        !/greystar|colosseum/i.test(`${mission.account.name} ${mission.code}`)
      )
        return [primary];
      return [
        {
          ...primary,
          id: `${primary.id}-email`,
          title: `${mission.account.name} email follow-up`,
          timeLabel: "Flexible · 20 min",
          fixed: false,
          address: null,
          navigationUrl: null,
          status:
            primary.status === "completed"
              ? ("completed" as const)
              : ("ready" as const),
        },
        {
          ...primary,
          id: `${primary.id}-visits`,
          title: `${mission.account.name} field visits`,
          timeLabel: input.physicalVisitBlocked
            ? "Deferred · readiness required"
            : "Readiness unknown",
          fixed: false,
          status:
            primary.status === "completed"
              ? ("completed" as const)
              : input.physicalVisitBlocked
                ? ("blocked" as const)
                : ("upcoming" as const),
        },
      ];
    }),
    ...(input.commitments ?? []).map(
      (commitment, index): DayPlanStop => ({
        id: `commitment-${commitment.id}`,
        action: { type: "commitment", id: commitment.id },
        kind: commitment.kind === "growth" ? "growth" : "prep",
        title: commitment.title,
        source: "user_commitment",
        sourceLabel:
          commitment.provenance === "user_reported"
            ? "You committed today"
            : "Added manually",
        timeLabel: commitment.quantity
          ? `${commitment.quantity} to complete`
          : "Flexible today",
        sortKey: `75:${String(index).padStart(3, "0")}`,
        estimatedMinutes: null,
        status: commitment.status === "completed" ? "completed" : "upcoming",
        fixed: false,
        address: null,
        navigationUrl: null,
        missionTarget: null,
        completedAt: commitment.completedAt,
      })
    ),
    ...(input.liveObjectives ?? []).map((objective): DayPlanStop => ({
      id: `living-world-${objective.id}`,
      kind: objective.kind,
      title: objective.title,
      source: "living_world",
      sourceLabel: `${objective.sourceLabel} · ${objective.explanation}`,
      timeLabel: objective.dueAt ? `Due ${new Date(objective.dueAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Flexible today",
      sortKey: objective.dueAt ?? `72:${objective.id}`,
      estimatedMinutes: null,
      status: objective.status === "ready" ? "ready" : objective.status,
      fixed: Boolean(objective.dueAt),
      address: objective.address,
      latitude: objective.latitude,
      longitude: objective.longitude,
      physicalEntityId: objective.physicalEntityId,
      navigationUrl: navigationUrl(objective.address),
      missionTarget: null,
      completedAt: objective.status === "completed" ? new Date().toISOString() : null,
      whySurfaced: objective.explanation,
      sourceEvidenceReference: objective.sourceEvidenceReference,
      sourceOccurredAt: objective.sourceOccurredAt,
    })),
  ];
  const pickups = baseStops.filter(
    stop => stop.kind === "pickup" && stop.status !== "cancelled"
  );
  const finalPickup = [...pickups]
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .at(-1);
  const represented =
    input.processingLocation &&
    baseStops.some(stop =>
      stop.title
        .toLowerCase()
        .includes(input.processingLocation!.name.toLowerCase())
    );
  if (finalPickup && input.processingLocation && !represented) {
    baseStops.push({
      id: `derived-processing-${input.businessDate}`,
      kind: "processing",
      title: input.processingLocation.name,
      source: "derived_operation",
      sourceLabel: `Auto-added after final pickup${input.processingLocation.locality ? ` · ${input.processingLocation.locality}` : ""}`,
      timeLabel: "Processing handoff",
      sortKey: `${finalPickup.sortKey}~processing`,
      estimatedMinutes: null,
      status: "upcoming",
      fixed: false,
      address: input.processingLocation.address,
      navigationUrl: navigationUrl(input.processingLocation.address),
      missionTarget: null,
      completedAt: null,
    });
  }
  const deduped = baseStops.filter(unique);
  const stops = input.campaignChapters?.length
    ? projectStopsOntoCampaign(deduped, input.campaignChapters)
    : (() => {
        const compiled = compileGoldlineAdventure({
          date: input.businessDate,
          territoryBundles: input.territoryBundles,
          objectives: deduped.map(stop => ({
            id: stop.id, physicalEntityId: stop.physicalEntityId ?? null,
            kind: stop.kind === "pickup" ? "pickup" : stop.kind === "dropoff" ? "delivery" : stop.source === "living_world" && /recovery/i.test(stop.sourceLabel) ? "recovery" : stop.kind === "sales" ? "commercial_visit" : "field_capture",
            authority: stop.fixed ? "fixed_commitment" : stop.source === "living_world" ? "persisted_task" : "derived_recommendation",
            status: stop.status === "completed" ? "completed" : stop.status === "blocked" || stop.status === "cancelled" ? "blocked" : "ready",
            latitude: stop.latitude ?? null, longitude: stop.longitude ?? null, windowStart: stop.fixed ? stop.sortKey : null, windowEnd: null,
            priority: stop.source === "living_world" ? 8 : stop.fixed ? 10 : 4,
            explanation: stop.sourceLabel, sourceEvidenceReference: `${stop.source}:${stop.id}`,
          })),
        });
        const rank = new Map(compiled.ordered.map((objective, index) => [objective.id, index]));
        return deduped.sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) || a.sortKey.localeCompare(b.sortKey));
      })();
  const counts: Record<DayPlanStopKind, number> = {
    pickup: 0,
    dropoff: 0,
    sales: 0,
    prep: 0,
    processing: 0,
    growth: 0,
  };
  for (const stop of stops) counts[stop.kind] += 1;
  return {
    businessDate: input.businessDate,
    stops,
    counts,
    fixedWindowCount: stops.filter(stop => stop.fixed).length,
    cleanCloudCount: stops.filter(stop => stop.source === "cleancloud").length,
    growthCoverage: stops.some(
      stop =>
        stop.kind === "growth" ||
        (stop.kind === "sales" && stop.status === "ready")
    )
      ? "covered"
      : stops.some(stop => stop.kind === "sales" && stop.status === "blocked")
        ? "blocked"
        : "underfilled",
  };
}
