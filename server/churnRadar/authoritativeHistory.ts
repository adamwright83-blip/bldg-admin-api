import type { Order, OperationsEvent } from "../../drizzle/schema";
import type { CustomerHistoryObservation } from "../../shared/customerChurn";
import type { PaidOrderEvent } from "../analytics/paidOrderLedger";

export type ChurnNativeOrder = Pick<
  Order,
  | "id"
  | "status"
  | "serviceType"
  | "heldMetadataJson"
  | "residentClientRequestId"
  | "createdAt"
>;

export type ChurnDropoffEvidence = Pick<
  OperationsEvent,
  | "id"
  | "orderId"
  | "sourceEventType"
  | "eventStatus"
  | "actualEventTimestamp"
  | "updatedAt"
  | "weightLbs"
>;

export type AuthoritativeChurnObservation = CustomerHistoryObservation & {
  serviceEvidenceKind: "dropoff_event" | "historical_cadence_import";
  serviceEvidenceRef: string;
  paymentAuthorityReceiptId: string | null;
};

export function nativePaidOrderId(event: PaidOrderEvent): number | null {
  if (
    event.source !== "laundry_butler" ||
    !event.authorityReceiptId ||
    !event.eventKey.startsWith("order:") ||
    !Number.isFinite(event.cents) ||
    event.cents < 0
  ) {
    return null;
  }
  const orderId = Number(event.eventKey.slice("order:".length));
  return Number.isSafeInteger(orderId) && orderId > 0 ? orderId : null;
}

function historicalCadenceServiceAt(order: ChurnNativeOrder): Date | null {
  if (
    order.status !== "delivered" ||
    !order.residentClientRequestId?.startsWith("goldline:cadence:") ||
    !order.heldMetadataJson ||
    typeof order.heldMetadataJson !== "object" ||
    Array.isArray(order.heldMetadataJson)
  ) {
    return null;
  }
  const metadata = order.heldMetadataJson as Record<string, unknown>;
  if (
    metadata.importSource !== "goldline_customer_order_history" ||
    metadata.cadenceEvidenceOnly !== true ||
    typeof metadata.cleancloudCustomerId !== "string" ||
    !metadata.cleancloudCustomerId.trim()
  ) {
    return null;
  }
  return Number.isFinite(order.createdAt.getTime()) ? order.createdAt : null;
}

function evidenceIsNewer(
  next: ChurnDropoffEvidence,
  current: ChurnDropoffEvidence
): boolean {
  const updatedDelta = next.updatedAt.getTime() - current.updatedAt.getTime();
  if (updatedDelta !== 0) return updatedDelta > 0;
  const actualDelta =
    next.actualEventTimestamp.getTime() -
    current.actualEventTimestamp.getTime();
  if (actualDelta !== 0) return actualDelta > 0;
  return next.id > current.id;
}

export function isActiveChurnOrder(
  order: Pick<ChurnNativeOrder, "status">
): boolean {
  return !["delivered", "cancelled"].includes(order.status);
}

/**
 * Churn cadence is a service-completion question, not a payment question.
 *
 * A native order enters completed history only when a non-voided
 * operations_events.dropoff_completed receipt exists, or when the existing
 * Goldline historical-order import explicitly marks the row cadenceEvidenceOnly
 * with its source identity. Ordinary delivered/paid flags are not evidence.
 * Monetary value is attached independently from the admitted native paid-order
 * ledger. Missing payment authority never erases a real completed service; it
 * leaves that observation's value unavailable.
 */
export function buildAuthoritativeChurnHistory(input: {
  orders: readonly ChurnNativeOrder[];
  dropoffEvents: readonly ChurnDropoffEvidence[];
  paidEvents: readonly PaidOrderEvent[];
}): AuthoritativeChurnObservation[] {
  const ordersById = new Map(input.orders.map(order => [order.id, order]));
  const completionByOrder = new Map<number, ChurnDropoffEvidence>();

  for (const event of input.dropoffEvents) {
    if (
      event.orderId == null ||
      event.sourceEventType !== "dropoff_completed" ||
      !ordersById.has(event.orderId)
    ) {
      continue;
    }
    const current = completionByOrder.get(event.orderId);
    if (!current || evidenceIsNewer(event, current)) {
      completionByOrder.set(event.orderId, event);
    }
  }

  const paymentByOrder = new Map<
    number,
    { cents: number; authorityReceiptId: string }
  >();
  for (const event of input.paidEvents) {
    const orderId = nativePaidOrderId(event);
    if (orderId == null || !ordersById.has(orderId)) continue;
    paymentByOrder.set(orderId, {
      cents: Math.round(event.cents),
      authorityReceiptId: event.authorityReceiptId!,
    });
  }

  const history: AuthoritativeChurnObservation[] = [];
  for (const order of input.orders) {
    const completion = completionByOrder.get(order.id);
    if (completion?.eventStatus === "voided") continue;

    const importedServiceAt = completion
      ? null
      : historicalCadenceServiceAt(order);
    if (!completion && !importedServiceAt) continue;

    const payment = paymentByOrder.get(order.id);
    history.push({
      orderId: order.id,
      serviceAt: completion?.actualEventTimestamp ?? importedServiceAt!,
      valueCents: payment?.cents ?? null,
      weightLbs:
        completion?.weightLbs == null ? null : Number(completion.weightLbs),
      serviceType: order.serviceType,
      serviceEvidenceKind: completion
        ? "dropoff_event"
        : "historical_cadence_import",
      serviceEvidenceRef: completion
        ? `operations_events:${completion.id}`
        : `orders:${order.id}:goldline_customer_order_history`,
      paymentAuthorityReceiptId: payment?.authorityReceiptId ?? null,
    });
  }

  return history.sort((left, right) => {
    const leftAt =
      left.serviceAt instanceof Date
        ? left.serviceAt.getTime()
        : new Date(left.serviceAt).getTime();
    const rightAt =
      right.serviceAt instanceof Date
        ? right.serviceAt.getTime()
        : new Date(right.serviceAt).getTime();
    return leftAt - rightAt || left.orderId - right.orderId;
  });
}
