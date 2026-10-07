import { and, eq, inArray, sql } from "drizzle-orm";
import { orders, type InsertOrder, type Order } from "../../drizzle/schema";
import {
  attemptOrderPickupCollection,
  createOrder,
  createOrReuseResidentLaundryOrder,
  getDb,
  getOrderById,
  updateOrderStatus,
} from "../db";
import type { OperationsEventActorContext } from "../operationsEvents";
import {
  assertOrderTenantAuthority,
  assertOrderVendorAuthority,
  OrderOwnershipError,
} from "./orderOwnership";

export type OrderStatus = Order["status"];

export type CreateNativeOrderInput = InsertOrder & {
  tenantId: string;
};

export type TransitionOrderInput = {
  orderId: number;
  status: OrderStatus;
  tenantId?: string | null;
  actor?: OperationsEventActorContext;
  vendorId?: number | null;
  allowCrossTenant?: boolean;
};

export type TransitionOrderResult = {
  success: true;
  alreadyCompleted: boolean;
  order: Order;
};

export class OrderTransitionError extends Error {
  readonly code: "NOT_FOUND" | "UNAUTHORIZED" | "PAYMENT_REQUIRED" | "INVALID_TRANSITION";

  constructor(
    code: "NOT_FOUND" | "UNAUTHORIZED" | "PAYMENT_REQUIRED" | "INVALID_TRANSITION",
    message: string
  ) {
    super(message);
    this.name = "OrderTransitionError";
    this.code = code;
  }
}

/**
 * Creates a native order through canonical authority.
 * Validates tenant authority and delegates to proven persistence primitives.
 */
export async function createNativeOrder(
  input: CreateNativeOrderInput
): Promise<number> {
  const tenantId = input.tenantId?.trim();
  if (!tenantId) {
    throw new Error("Order creation requires tenant authority");
  }
  return createOrder({
    ...input,
    tenantId,
  });
}

/**
 * Creates or reuses a resident-originated laundry order.
 * Preserves tenant scoping, resident matching, unique clientRequestId idempotency,
 * and duplicate protection.
 */
export async function createOrReuseResidentOrder(
  order: InsertOrder,
  opts?: { clientRequestId?: string | null }
): Promise<{ orderId: number; reused: boolean }> {
  return createOrReuseResidentLaundryOrder(order, opts);
}

/**
 * Authoritatively executes an atomic delivery transition if conditions are met.
 * Condition: Delivery rejects when order.paid is false.
 * Idempotency: If already delivered, returns alreadyCompleted: true without duplicating effects.
 */
export async function attemptOrderDeliveryTransition(
  orderId: number,
  expectedTenantId?: string | null,
  existingOrder?: Order
): Promise<{ transitioned: boolean; alreadyCompleted: boolean; order: Order }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const order = existingOrder ?? (await getOrderById(orderId));
  if (!order) {
    throw new OrderTransitionError("NOT_FOUND", "Order not found");
  }

  if (expectedTenantId) {
    try {
      assertOrderTenantAuthority({
        order,
        tenantId: expectedTenantId,
      });
    } catch (error) {
      if (error instanceof OrderOwnershipError) {
        throw new OrderTransitionError("UNAUTHORIZED", error.message);
      }
      throw error;
    }
  }

  // Idempotency: already delivered
  if (order.status === "delivered") {
    return { transitioned: false, alreadyCompleted: true, order };
  }

  // Precondition: delivery rejects when order.paid === false
  if (!order.paid) {
    throw new OrderTransitionError(
      "PAYMENT_REQUIRED",
      "Charge the order before marking it delivered."
    );
  }

  const conditions = [
    eq(orders.id, orderId),
    eq(orders.paid, true),
  ];
  if (expectedTenantId) {
    conditions.push(
      sql`COALESCE(NULLIF(TRIM(${orders.tenantId}), ''), 'default') = ${expectedTenantId.trim()}`
    );
  }

  const result = await db
    .update(orders)
    .set({ status: "delivered" })
    .where(and(...conditions));

  const affectedRows = Number(
    (result as { [0]?: { affectedRows?: number } })[0]?.affectedRows ?? 0
  );

  const updatedOrder = await getOrderById(orderId);
  if (!updatedOrder) {
    throw new OrderTransitionError("NOT_FOUND", "Order not found after update");
  }

  return {
    transitioned: affectedRows > 0,
    alreadyCompleted: affectedRows === 0 && updatedOrder.status === "delivered",
    order: updatedOrder,
  };
}

/**
 * Authoritative single entry point for transitioning native order status.
 * Enforces:
 * 1. Existence and tenant ownership
 * 2. Vendor authorization
 * 3. Atomic pickup collection semantics
 * 4. Payment precondition on delivery (rejects if unpaid)
 * 5. Idempotent replay for delivery and pickup
 */
export async function transitionNativeOrderStatus(
  input: TransitionOrderInput
): Promise<TransitionOrderResult> {
  const order = await getOrderById(input.orderId);
  if (!order) {
    throw new OrderTransitionError("NOT_FOUND", "Order not found");
  }

  const requestedTenant = input.tenantId?.trim();
  if (requestedTenant) {
    try {
      assertOrderTenantAuthority({
        order,
        tenantId: requestedTenant,
        allowCrossTenant: input.allowCrossTenant,
        // Preserve the existing vendor-status behavior: a vendor session on
        // the legacy default host was not tenant-restricted here. Vendor
        // assignment remains the authority for that path.
        allowLegacyDefaultWildcard: input.vendorId != null,
      });
    } catch (error) {
      if (error instanceof OrderOwnershipError) {
        throw new OrderTransitionError("UNAUTHORIZED", error.message);
      }
      throw error;
    }
  }

  if (input.vendorId != null) {
    try {
      assertOrderVendorAuthority({
        order,
        vendorId: input.vendorId,
        // Existing updateStatus behavior allowed a vendor to transition an
        // unassigned order. Preserve it; do not invent assignment policy here.
        allowUnassigned: true,
      });
    } catch (error) {
      if (error instanceof OrderOwnershipError) {
        throw new OrderTransitionError("UNAUTHORIZED", error.message);
      }
      throw error;
    }
  }

  // 1. Pickup transition
  if (input.status === "collected") {
    const { transitioned, order: collectedOrder } =
      await attemptOrderPickupCollection(input.orderId);
    if (!collectedOrder) {
      throw new OrderTransitionError("NOT_FOUND", "Order not found");
    }
    if (!transitioned) {
      return {
        success: true,
        alreadyCompleted: true,
        order: collectedOrder,
      };
    }
    return {
      success: true,
      alreadyCompleted: false,
      order: collectedOrder,
    };
  }

  // 2. Delivery transition
  if (input.status === "delivered") {
    const { transitioned, alreadyCompleted, order: deliveredOrder } =
      await attemptOrderDeliveryTransition(input.orderId, requestedTenant, order);
    if (!transitioned && !alreadyCompleted) {
      throw new OrderTransitionError(
        "INVALID_TRANSITION",
        "Order could not be delivered."
      );
    }
    return {
      success: true,
      alreadyCompleted,
      order: deliveredOrder,
    };
  }

  // 3. Replay of same status
  if (order.status === input.status) {
    return {
      success: true,
      alreadyCompleted: true,
      order,
    };
  }

  // 4. Other transitions
  await updateOrderStatus(input.orderId, input.status, input.actor);
  const updatedOrder = await getOrderById(input.orderId);
  if (!updatedOrder) {
    throw new OrderTransitionError("NOT_FOUND", "Order not found after update");
  }

  return {
    success: true,
    alreadyCompleted: false,
    order: updatedOrder,
  };
}
