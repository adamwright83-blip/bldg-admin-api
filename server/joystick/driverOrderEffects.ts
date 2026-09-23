import { and, eq } from "drizzle-orm";
import { operationsEvents, type Order } from "../../drizzle/schema";
import { notifyPickupEnRoute } from "../_core/sms";
import { getDb } from "../db";
import { buildOperationEventForOrderStatusChange } from "../operationsEvents";
import { recordWarActionSafe } from "../level4War";
import { canonicalOrderTenantId } from "./driverOrderTenant";

type DriverOrderEffect = {
  tenantId: string;
  order: Order;
  actorUserId: number | null;
  actorDisplayName: string | null;
};

function effectAllowed(input: DriverOrderEffect): boolean {
  return canonicalOrderTenantId(input.order.tenantId) === input.tenantId;
}

async function persistStatusEvent(
  input: DriverOrderEffect & { nextStatus: "collected" | "delivered" }
): Promise<void> {
  if (!effectAllowed(input)) return;
  const db = await getDb();
  if (!db) return;
  try {
    const event = buildOperationEventForOrderStatusChange({
      order: input.order,
      previousStatus: input.order.status,
      nextStatus: input.nextStatus,
      actor: {
        source: "driver_app_bldg",
        actorUserId: input.actorUserId,
        actorDisplayName: input.actorDisplayName,
        actualEventTimestamp: new Date(),
      },
    });
    if (!event) return;
    event.tenantId = input.tenantId;
    const existing = await db
      .select({ id: operationsEvents.id })
      .from(operationsEvents)
      .where(
        and(
          eq(operationsEvents.orderId, input.order.id),
          eq(operationsEvents.tenantId, input.tenantId),
          eq(operationsEvents.sourceEventType, event.sourceEventType)
        )
      )
      .limit(1);
    if (existing.length > 0) return;
    await db
      .insert(operationsEvents)
      .values(event)
      .onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
  } catch (error) {
    console.warn("[DriverOrders] status event not recorded", error);
  }
}

/** Pickup side effects for an order the caller already proved belongs to tenantId. */
export async function recordDriverOrderCollected(
  input: DriverOrderEffect
): Promise<void> {
  if (!effectAllowed(input)) return;
  await persistStatusEvent({ ...input, nextStatus: "collected" });
  recordWarActionSafe({
    tenantId: input.tenantId,
    kind: "stage_advance",
    dedupeKey: `stage:${input.order.id}:collected`,
    meta: { orderId: input.order.id, status: "collected" },
  });
  try {
    await notifyPickupEnRoute(input.order.phone);
  } catch (error) {
    console.warn("[DriverOrders] pickup SMS not sent", error);
  }
}

/** Delivery side effects. No SMS: delivery texts stay on the existing ready path. */
export async function recordDriverOrderDelivered(
  input: DriverOrderEffect
): Promise<void> {
  if (!effectAllowed(input)) return;
  await persistStatusEvent({ ...input, nextStatus: "delivered" });
  recordWarActionSafe({
    tenantId: input.tenantId,
    kind: "stage_advance",
    dedupeKey: `stage:${input.order.id}:delivered`,
    meta: { orderId: input.order.id, status: "delivered" },
  });
}
