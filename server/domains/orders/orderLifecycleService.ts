import { readNativePaymentAuthorityReceipts, hasNativePaymentAuthority } from "../payment/nativePaymentReadService";
import * as persistence from "../../db";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { orders, type InsertOrder, type Order } from "../../../drizzle/schema";
import {
  attemptOrderPickupCollection,
  createOrder,
  createOrReuseResidentLaundryOrder,
  getDb,
  getOrderById,
  updateOrderStatus,
  OrderUpdateConflictError,
  type UpdateOrderStatusGuard,
} from "../../db";
import type { OperationsEventActorContext } from "../../operationsEvents";
import {
  assertOrderTenantAuthority,
  assertOrderVendorAuthority,
  canonicalOrderTenantId,
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

export type PaymentAdmissionStatusDisposition = {
  previousStatus: OrderStatus;
  resultingStatus: OrderStatus;
  transitioned: boolean;
  preservedExistingStatus: boolean;
  cancelled: boolean;
};

export type LockedOrderRowForPaymentAdmission = {
  id: number;
  tenantId: string | null;
  status: OrderStatus;
};

export type TransitionOrderResult = {
  success: true;
  alreadyCompleted: boolean;
  order: Order;
};

export class OrderTransitionError extends Error {
  readonly code:
    | "NOT_FOUND"
    | "UNAUTHORIZED"
    | "PAYMENT_REQUIRED"
    | "INVALID_TRANSITION"
    | "CONFLICT";

  constructor(
    code:
      | "NOT_FOUND"
      | "UNAUTHORIZED"
      | "PAYMENT_REQUIRED"
      | "INVALID_TRANSITION"
      | "CONFLICT",
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
  assertNonPaymentWrite(input);
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
  assertNonPaymentWrite(order);
  if (!order.tenantId?.trim())
    throw new Error("Resident order creation requires tenant authority");
  return createOrReuseResidentLaundryOrder(order, opts);
}

/**
 * Authoritatively executes an atomic delivery transition if conditions are met.
 * Condition: Delivery requires matching Payment admission, regardless of capture amount availability.
 * Idempotency: If already delivered, returns alreadyCompleted: true without duplicating effects.
 */
export async function attemptOrderDeliveryTransition(
  orderId: number,
  expectedTenantId?: string | null,
  existingOrder?: Order,
  guard?: {
    expectedVendorId?: number | null;
    requireUnassignedVendor?: boolean;
  }
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

  // Delivery never creates payment, including replay of imported unpaid history.
  if (!order.paid) {
    throw new OrderTransitionError(
      "PAYMENT_REQUIRED",
      "Charge the order before marking it delivered."
    );
  }
  const paymentReceipts = await readNativePaymentAuthorityReceipts([order]);
  if (!hasNativePaymentAuthority(order, paymentReceipts.get(order.id))) {
    throw new OrderTransitionError("PAYMENT_REQUIRED", "Matching Payment admission is required before delivery.");
  }
  if (order.status === "delivered") {
    return { transitioned: false, alreadyCompleted: true, order };
  }

  const conditions = [
    eq(orders.id, orderId),
    eq(orders.paid, true),
    eq(orders.tenantId, order.tenantId!),
    eq(orders.stripePaymentIntentId, order.stripePaymentIntentId!),
    ne(orders.status, "delivered"),
  ];
  if (expectedTenantId) {
    conditions.push(
      sql`COALESCE(NULLIF(TRIM(${orders.tenantId}), ''), 'default') = ${expectedTenantId.trim()}`
    );
  }
  if (guard?.requireUnassignedVendor) {
    conditions.push(isNull(orders.vendorId));
  } else if (guard?.expectedVendorId !== undefined && guard.expectedVendorId !== null) {
    conditions.push(eq(orders.vendorId, guard.expectedVendorId));
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
  if (!requestedTenant) {
    throw new OrderTransitionError(
      "UNAUTHORIZED",
      "Order transition requires tenant authority"
    );
  }

  const isCrossTenantAssignedVendor =
    input.vendorId != null &&
    order.vendorId != null &&
    order.vendorId === input.vendorId;

  try {
    assertOrderTenantAuthority({
      order,
      tenantId: requestedTenant,
      allowCrossTenant: Boolean(
        input.allowCrossTenant || isCrossTenantAssignedVendor
      ),
    });
  } catch (error) {
    if (error instanceof OrderOwnershipError) {
      throw new OrderTransitionError("UNAUTHORIZED", error.message);
    }
    throw error;
  }

  if (input.vendorId != null) {
    try {
      assertOrderVendorAuthority({
        order,
        vendorId: input.vendorId,
        // Existing updateStatus behavior allowed a vendor to transition an
        // unassigned order on the same tenant.
        allowUnassigned: true,
      });
    } catch (error) {
      if (error instanceof OrderOwnershipError) {
        throw new OrderTransitionError("UNAUTHORIZED", error.message);
      }
      throw error;
    }
  }

  const mutationGuard: UpdateOrderStatusGuard = {
    expectedTenantId: order.tenantId,
    ...(input.vendorId != null
      ? order.vendorId == null
        ? { requireUnassignedVendor: true }
        : { expectedVendorId: input.vendorId }
      : {}),
  };

  // 1. Pickup transition
  if (input.status === "collected") {
    if (order.status === "cancelled")
      throw new OrderTransitionError(
        "INVALID_TRANSITION",
        "This order cannot be collected."
      );
    const { transitioned, order: collectedOrder } =
      await attemptOrderPickupCollection(input.orderId, order.tenantId, mutationGuard);
    if (!collectedOrder) {
      throw new OrderTransitionError("NOT_FOUND", "Order not found");
    }
    if (!transitioned) {
      if (
        !["collected", "processing", "ready", "delivered"].includes(
          collectedOrder.status
        )
      ) {
        throw new OrderTransitionError(
          "CONFLICT",
          "Order could not be collected."
        );
      }
      if (
        mutationGuard.expectedTenantId !== undefined &&
        canonicalOrderTenantId(collectedOrder.tenantId) !==
          canonicalOrderTenantId(mutationGuard.expectedTenantId)
      ) {
        throw new OrderTransitionError(
          "CONFLICT",
          "Order tenant changed concurrently"
        );
      }
      if (
        mutationGuard.requireUnassignedVendor &&
        collectedOrder.vendorId != null
      ) {
        throw new OrderTransitionError(
          "CONFLICT",
          "Order vendor assignment changed concurrently"
        );
      }
      if (
        mutationGuard.expectedVendorId !== undefined &&
        mutationGuard.expectedVendorId !== null &&
        collectedOrder.vendorId !== mutationGuard.expectedVendorId
      ) {
        throw new OrderTransitionError(
          "CONFLICT",
          "Order vendor assignment changed concurrently"
        );
      }
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
    const {
      transitioned,
      alreadyCompleted,
      order: deliveredOrder,
    } = await attemptOrderDeliveryTransition(
      input.orderId,
      requestedTenant,
      order,
      mutationGuard
    );
    if (!transitioned && !alreadyCompleted) {
      throw new OrderTransitionError(
        "INVALID_TRANSITION",
        "Order could not be delivered."
      );
    }
    if (alreadyCompleted) {
      if (
        mutationGuard.expectedTenantId !== undefined &&
        canonicalOrderTenantId(deliveredOrder.tenantId) !==
          canonicalOrderTenantId(mutationGuard.expectedTenantId)
      ) {
        throw new OrderTransitionError(
          "CONFLICT",
          "Order tenant changed concurrently"
        );
      }
      if (
        mutationGuard.requireUnassignedVendor &&
        deliveredOrder.vendorId != null
      ) {
        throw new OrderTransitionError(
          "CONFLICT",
          "Order vendor assignment changed concurrently"
        );
      }
      if (
        mutationGuard.expectedVendorId !== undefined &&
        mutationGuard.expectedVendorId !== null &&
        deliveredOrder.vendorId !== mutationGuard.expectedVendorId
      ) {
        throw new OrderTransitionError(
          "CONFLICT",
          "Order vendor assignment changed concurrently"
        );
      }
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
  try {
    await updateOrderStatus(input.orderId, input.status, input.actor, mutationGuard);
  } catch (error) {
    if (
      error instanceof OrderUpdateConflictError ||
      (error instanceof Error &&
        (error.message.includes("concurrently") ||
          error.message.includes("conflict")))
    ) {
      throw new OrderTransitionError("CONFLICT", error.message);
    }
    throw error;
  }
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

/** Order revisions cannot create payment truth or bypass lifecycle authority. */
export async function reviseNativeOrder(
  orderId: number,
  data: Partial<
    Omit<InsertOrder, "paid" | "paidAt" | "stripePaymentIntentId" | "tenantId" | "platformFeeCents" | "vendorPayoutCents" | "stripeConnectedAccountIdSnapshot">
  >
): Promise<void> {
  assertNonPaymentWrite(data);
  if (
    ["paid", "paidAt", "stripePaymentIntentId", "tenantId", "platformFeeCents", "vendorPayoutCents", "stripeConnectedAccountIdSnapshot"].some(
      key => key in data
    )
  ) {
    throw new Error("Order revision cannot change payment or tenant authority");
  }
  const { status, ...fields } = data;
  if (status !== undefined) {
    await transitionNativeOrderStatus({ orderId, status });
  }
  if (Object.keys(fields).length > 0)
    await persistence.updateOrderIntake(orderId, fields);
}

export async function attachNativeOrderPaymentMethod(
  orderId: number,
  customerId: string,
  paymentMethodId: string
): Promise<void> {
  await persistence.updateOrderStripe(orderId, customerId, paymentMethodId);
}

export async function attributeNativeOrderToBuilding(
  orderId: number,
  buildingSlug: string
): Promise<void> {
  await persistence.updateOrderBuildingSlug(orderId, buildingSlug);
}

export async function attributeNativeCustomerOrdersToBuilding(
  input: Parameters<typeof persistence.updateOrderBuildingSlugForCustomer>[0]
): Promise<number> {
  return persistence.updateOrderBuildingSlugForCustomer(input);
}

export async function assignNativeOrderVendor(
  orderId: number,
  vendorId: number | null
): Promise<void> {
  await persistence.updateOrderVendor(orderId, vendorId);
}

export async function deleteNativeOrder(orderId: number): Promise<void> {
  await persistence.deleteOrder(orderId);
}

function assertNonPaymentWrite(data: object): void {
  const patch = data as Record<string, unknown>;
  if (
    patch.paid === true ||
    patch.paidAt != null ||
    patch.stripePaymentIntentId != null
  ) {
    throw new Error(
      "Native payment state requires Payment admission authority"
    );
  }
  if ("paid" in patch && patch.paid !== false) {
    throw new Error(
      "Native payment state requires Payment admission authority"
    );
  }
}

/**
 * Narrow Orders-owned lifecycle helper executed within an established payment admission transaction.
 *
 * Requirements:
 * - Accepts ONLY the database transaction and locked order row (with tenantId).
 * - Cannot accept arbitrary statuses: only advances eligible pre-processing states to "processing".
 * - If the locked status is already "processing", "ready", "collected", or "delivered", preserves existing status without regression.
 * - If the locked status is "cancelled", preserves "cancelled" status and marks disposition as cancelled.
 * - Otherwise ("new", "intake-pending"), transitions status to "processing".
 */
export async function admitOrderProcessingStatusInTransaction(
  tx: any,
  lockedOrder: LockedOrderRowForPaymentAdmission,
  tenantId: string
): Promise<PaymentAdmissionStatusDisposition> {
  const currentStatus = lockedOrder.status;

  // 1. Preserved post-intake and terminal execution statuses: do not change or regress
  if (
    currentStatus === "processing" ||
    currentStatus === "ready" ||
    currentStatus === "collected" ||
    currentStatus === "delivered"
  ) {
    return {
      previousStatus: currentStatus,
      resultingStatus: currentStatus,
      transitioned: false,
      preservedExistingStatus: true,
      cancelled: false,
    };
  }

  // 2. Preserved cancelled status: do not change, flag for caller reconciliation
  if (currentStatus === "cancelled") {
    return {
      previousStatus: currentStatus,
      resultingStatus: currentStatus,
      transitioned: false,
      preservedExistingStatus: true,
      cancelled: true,
    };
  }

  // 3. Set processing for other statuses (e.g. "new", "intake-pending")
  await tx
    .update(orders)
    .set({ status: "processing" })
    .where(and(eq(orders.id, lockedOrder.id), eq(orders.tenantId, tenantId)));

  return {
    previousStatus: currentStatus,
    resultingStatus: "processing",
    transitioned: true,
    preservedExistingStatus: false,
    cancelled: false,
  };
}
