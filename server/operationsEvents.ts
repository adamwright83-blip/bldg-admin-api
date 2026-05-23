import { BUILDINGS, matchBuilding } from "@shared/buildings";
import { normalizePropertyTower } from "@shared/propertyTowers";
import { TENANT_CONFIG, type TenantId } from "@shared/tenantConfig";
import type { InsertOperationsEvent, Order } from "../drizzle/schema";

export type OperationsEventSource =
  | "driver_app_bldg"
  | "cleancloud_csv"
  | "cleancloud_playbook"
  | "system_backfill";

export type OperationsEventActorContext = {
  source?: OperationsEventSource;
  actorUserId?: string | number | null;
  actorDisplayName?: string | null;
  actualEventTimestamp?: Date;
};

const STATUS_RANK: Record<Order["status"], number> = {
  new: 0,
  "intake-pending": 1,
  collected: 2,
  processing: 3,
  ready: 4,
  delivered: 5,
};

export function shouldCaptureOperationEvent(input: {
  previousStatus: Order["status"];
  nextStatus: Order["status"];
}): boolean {
  if (input.nextStatus !== "collected" && input.nextStatus !== "delivered") return false;
  return STATUS_RANK[input.previousStatus] < STATUS_RANK[input.nextStatus];
}

function tenantLabel(tenantId: string | null | undefined): string {
  const key = (tenantId ?? "default") as TenantId;
  return TENANT_CONFIG[key]?.brandName ?? tenantId ?? "Laundry Butler";
}

function buildingBySlug(slug: string | null | undefined) {
  const normalized = slug?.trim().toLowerCase();
  if (!normalized) return null;
  return BUILDINGS.find((building) =>
    building.slug.toLowerCase() === normalized ||
    building.slugAliases.some((alias) => alias.toLowerCase() === normalized)
  ) ?? null;
}

function resolveBuilding(order: Order): Pick<
  InsertOperationsEvent,
  "buildingName" | "buildingSlug" | "tower" | "buildingResolutionStatus"
> {
  const configuredBuilding = buildingBySlug(order.buildingSlug) ?? matchBuilding(order.address);
  const tower = normalizePropertyTower(order.address, {
    propertyGroup:
      configuredBuilding?.id === "opus_la"
        ? "opus_la"
        : configuredBuilding?.id === "century_park_east"
          ? "century_park_east"
          : undefined,
  });
  const slug = order.buildingSlug?.trim() || configuredBuilding?.slug || null;
  const buildingName =
    configuredBuilding?.name ??
    (tower.propertyGroup === "unknown" ? null : tower.propertyDisplayName);
  const towerName = tower.towerKey === "unknown" ? null : tower.towerDisplayName;
  const hasUnresolvedBuildingHint = Boolean(order.buildingSlug?.trim()) && !configuredBuilding;

  return {
    buildingName,
    buildingSlug: slug,
    tower: towerName,
    buildingResolutionStatus:
      buildingName || slug || towerName
        ? hasUnresolvedBuildingHint
          ? "unresolved_needs_mapping"
          : "resolved"
        : "not_applicable",
  };
}

export function buildOperationEventForOrderStatusChange(input: {
  order: Order;
  previousStatus: Order["status"];
  nextStatus: Order["status"];
  actor?: OperationsEventActorContext;
}): InsertOperationsEvent | null {
  if (!shouldCaptureOperationEvent(input)) return null;

  const isPickup = input.nextStatus === "collected";
  return buildCompletedOperationEventForOrder({
    order: input.order,
    sourceEventType: isPickup ? "pickup_completed" : "dropoff_completed",
    actor: input.actor,
    rawJson: {
      previousStatus: input.previousStatus,
      nextStatus: input.nextStatus,
    },
  });
}

function buildCompletedOperationEventForOrder(input: {
  order: Order;
  sourceEventType: "pickup_completed" | "dropoff_completed";
  actor?: OperationsEventActorContext;
  rawJson?: Record<string, unknown>;
}): InsertOperationsEvent {
  const isPickup = input.sourceEventType === "pickup_completed";
  const order = input.order;
  const actualEventTimestamp = input.actor?.actualEventTimestamp ?? new Date();
  const building = resolveBuilding(order);
  const tenantId = order.tenantId ?? "default";
  const scheduledDate = isPickup ? order.pickupDate : order.deliveryDate;
  const scheduledWindow = isPickup ? order.pickupTimeWindow : order.deliveryTimeWindow;

  return {
    tenantId,
    businessUnitLabel: tenantLabel(tenantId),
    source: input.actor?.source ?? "driver_app_bldg",
    sourceEventType: input.sourceEventType,
    eventStatus: "completed",
    orderId: order.id,
    customerName: `${order.firstName} ${order.lastName}`.trim() || "Unknown Customer",
    customerPhone: order.phone ?? null,
    customerEmail: order.email ?? null,
    serviceType: order.serviceType,
    ...building,
    unit: order.unit ?? null,
    scheduledDate: scheduledDate ?? null,
    scheduledWindow: scheduledWindow ?? null,
    actualEventTimestamp,
    actorUserId: input.actor?.actorUserId != null ? String(input.actor.actorUserId) : null,
    actorDisplayName: input.actor?.actorDisplayName?.trim() || null,
    vendorId: order.vendorId ?? null,
    bagCount: order.bagCount ?? null,
    garmentCount: order.garmentCount ?? null,
    weightLbs: order.weightLbs ?? null,
    rawJson: {
      source: input.actor?.source ?? "driver_app_bldg",
      ...input.rawJson,
      orderSnapshot: order,
      capturedAt: actualEventTimestamp.toISOString(),
      vendorInitiated: Boolean(order.vendorId && !input.actor?.actorUserId),
    },
  };
}

export function buildPickupCompletedOperationsEventForOrder(input: {
  order: Order;
  actor?: OperationsEventActorContext;
  reason?: string;
}): InsertOperationsEvent {
  return buildCompletedOperationEventForOrder({
    order: input.order,
    sourceEventType: "pickup_completed",
    actor: {
      source: "system_backfill",
      ...input.actor,
    },
    rawJson: {
      reason: input.reason ?? "operations_event_backfill",
      synthesizedFrom: "order_payment_truth",
    },
  });
}
