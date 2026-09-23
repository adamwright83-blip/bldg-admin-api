import { NOT_ADMIN_ERR_MSG } from "@shared/const";
import { TRPCError } from "@trpc/server";
import type { Order } from "../../drizzle/schema";
import {
  recordDriverOrderCollected,
  recordDriverOrderDelivered,
} from "./driverOrderEffects";
import {
  getDriverOrderForTenant,
  listDriverOrdersByDate,
  listDriverOrdersByStatus,
  transitionDriverOrder,
} from "./driverOrderStore";
import {
  orderVisibleToTenant,
} from "./driverOrderTenant";

const LIST_STATUSES = [
  "new",
  "intake-pending",
  "collected",
  "processing",
  "ready",
  "delivered",
] as const;

export type DriverOrderListStatus = (typeof LIST_STATUSES)[number];
export type DriverOrderUpdateStatus = "collected" | "delivered";

const COLLECTED_DOWNSTREAM: Order["status"][] = [
  "collected",
  "processing",
  "ready",
  "delivered",
];

export function requireDriverSessionTenant(tenantId: string): string {
  const trimmed = tenantId.trim();
  if (!trimmed || trimmed === "__invalid_saas_session__") {
    throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
  }
  return trimmed;
}

function visibleRows<T extends { tenantId?: string | null; status: string }>(
  rows: T[] | null | undefined,
  input: { tenantId: string; status: string }
): T[] {
  return (rows ?? []).filter(
    row => row.status === input.status && orderVisibleToTenant(row, input.tenantId)
  );
}

export async function listDriverOrdersByStatusForMember(input: {
  tenantId: string;
  status: DriverOrderListStatus;
}): Promise<Order[]> {
  const tenantId = requireDriverSessionTenant(input.tenantId);
  const rows = await listDriverOrdersByStatus({
    tenantId,
    status: input.status,
  });
  return visibleRows(rows, { tenantId, status: input.status });
}

export async function listDriverOrdersByDateForMember(input: {
  tenantId: string;
  status: DriverOrderListStatus;
  date: string;
  dateField: "pickupDate" | "deliveryDate";
}): Promise<Order[]> {
  const tenantId = requireDriverSessionTenant(input.tenantId);
  const rows = await listDriverOrdersByDate({ ...input, tenantId });
  const column = input.dateField === "deliveryDate" ? "deliveryDate" : "pickupDate";
  return visibleRows(rows, { tenantId, status: input.status }).filter(
    row => row[column] === input.date
  );
}

export async function updateDriverOrderStatusForMember(input: {
  tenantId: string;
  orderId: number;
  status: DriverOrderUpdateStatus;
  actorUserId: number | null;
  actorDisplayName: string | null;
}): Promise<{ success: true; alreadyCompleted?: boolean }> {
  const tenantId = requireDriverSessionTenant(input.tenantId);
  const order = await getDriverOrderForTenant({
    tenantId,
    orderId: input.orderId,
  });
  if (!order || !orderVisibleToTenant(order, tenantId)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
  }

  if (input.status === "collected") {
    if (order.status !== "new" && order.status !== "intake-pending") {
      if (COLLECTED_DOWNSTREAM.includes(order.status)) {
        return { success: true, alreadyCompleted: true };
      }
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This order cannot be collected.",
      });
    }
    const { changed } = await transitionDriverOrder({
      tenantId,
      orderId: input.orderId,
      from: ["new", "intake-pending"],
      to: "collected",
    });
    if (!changed) {
      const current = await getDriverOrderForTenant({
        tenantId,
        orderId: input.orderId,
      });
      if (
        current &&
        orderVisibleToTenant(current, tenantId) &&
        COLLECTED_DOWNSTREAM.includes(current.status)
      ) {
        return { success: true, alreadyCompleted: true };
      }
      throw new TRPCError({
        code: "CONFLICT",
        message: "Order could not be collected.",
      });
    }
    await recordDriverOrderCollected({
      tenantId,
      order,
      actorUserId: input.actorUserId,
      actorDisplayName: input.actorDisplayName,
    });
    return { success: true, alreadyCompleted: false };
  }

  if (!order.paid) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Charge the order before marking it delivered.",
    });
  }
  if (order.status === "delivered") {
    return { success: true, alreadyCompleted: true };
  }
  const { changed } = await transitionDriverOrder({
    tenantId,
    orderId: input.orderId,
    to: "delivered",
  });
  if (!changed) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
  }
  await recordDriverOrderDelivered({
    tenantId,
    order,
    actorUserId: input.actorUserId,
    actorDisplayName: input.actorDisplayName,
  });
  return { success: true };
}
