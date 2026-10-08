import {
  transitionNativeOrderStatus,
  OrderTransitionError,
} from "../orders/orderLifecycleService";
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
} from "./driverOrderStore";
import { orderVisibleToTenant } from "./driverOrderTenant";

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
    row =>
      row.status === input.status && orderVisibleToTenant(row, input.tenantId)
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
  const column =
    input.dateField === "deliveryDate" ? "deliveryDate" : "pickupDate";
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

  if (input.status !== "collected" && input.status !== "delivered") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Unsupported Driver status",
    });
  }
  try {
    const result = await transitionNativeOrderStatus({
      tenantId,
      orderId: input.orderId,
      status: input.status,
      actor: {
        source: "driver_app_bldg",
        actorUserId: input.actorUserId,
        actorDisplayName: input.actorDisplayName,
      },
    });
    if (!result.alreadyCompleted) {
      const effect =
        input.status === "collected"
          ? recordDriverOrderCollected
          : recordDriverOrderDelivered;
      await effect({
        tenantId,
        order,
        actorUserId: input.actorUserId,
        actorDisplayName: input.actorDisplayName,
      });
    }
    return { success: true, alreadyCompleted: result.alreadyCompleted };
  } catch (error) {
    if (error instanceof OrderTransitionError) {
      throw new TRPCError({
        code:
          error.code === "CONFLICT"
            ? "CONFLICT"
            : error.code === "NOT_FOUND" || error.code === "UNAUTHORIZED"
              ? "NOT_FOUND"
              : "BAD_REQUEST",
        message:
          error.code === "UNAUTHORIZED" ? "Order not found" : error.message,
      });
    }
    throw error;
  }
}
