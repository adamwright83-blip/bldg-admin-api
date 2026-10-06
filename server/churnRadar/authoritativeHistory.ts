import type {
  Order,
  OperationsEvent,
  orderPaymentProjections,
} from "../../drizzle/schema";
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

export type ChurnPaymentProjection = Pick<
  typeof orderPaymentProjections.$inferSelect,
  "orderId" | "state" | "netPaidCents"
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
 * Monetary value is attached independently only when the admitted native
 * paid-order ledger and the existing order_payment_projections net-payment
 * state agree. Paid and partially_refunded use netPaidCents; refunded or
 * cancelled payments contribute zero realized value when the projection says
 * netPaidCents=0; review-required/missing projections stay unavailable.
 * Missing monetary authority never erases a real completed
 * service; it leaves that observation's value unavailable.
 */
export type AuthoritativeNativePayment = {
  orderId: number;
  occurredAt: Date;
  netPaidCents: number;
  authorityReceiptId: string;
  state: "paid" | "partially_refunded" | "refunded" | "cancelled";
};

export function buildAuthoritativeNativePayments(input: {
  orders: readonly ChurnNativeOrder[];
  paidEvents: readonly PaidOrderEvent[];
  paymentProjections: readonly ChurnPaymentProjection[];
}): AuthoritativeNativePayment[] {
  const ordersById = new Map(input.orders.map(order => [order.id, order]));
  const projections = new Map(
    input.paymentProjections
      .filter(row => ordersById.has(row.orderId))
      .map(row => [row.orderId, row])
  );
  const out: AuthoritativeNativePayment[] = [];
  for (const event of input.paidEvents) {
    const orderId = nativePaidOrderId(event);
    const order = orderId == null ? null : ordersById.get(orderId);
    if (orderId == null || !order) continue;
    const projection = projections.get(orderId);
    if (!projection) continue;

    const reversed =
      projection.state === "cancelled" || projection.state === "refunded";
    const rawNet = projection.netPaidCents;
    const validNet =
      rawNet !== null && Number.isSafeInteger(rawNet) && rawNet >= 0;
    if (
      !reversed &&
      (projection.state === "review_required" ||
        projection.state === "unpaid" ||
        !validNet)
    ) {
      continue;
    }
    if (
      !reversed &&
      projection.state !== "paid" &&
      projection.state !== "partially_refunded"
    ) {
      continue;
    }
    const state: AuthoritativeNativePayment["state"] =
      projection.state === "cancelled"
        ? "cancelled"
        : projection.state === "refunded"
          ? "refunded"
          : projection.state === "partially_refunded"
            ? "partially_refunded"
            : "paid";
    out.push({
      orderId,
      occurredAt: event.occurredAt,
      netPaidCents: reversed ? 0 : rawNet!,
      authorityReceiptId: event.authorityReceiptId!,
      state,
    });
  }
  return out.sort(
    (a, b) =>
      a.occurredAt.getTime() - b.occurredAt.getTime() ||
      a.orderId - b.orderId
  );
}

export function buildAuthoritativeChurnHistory(input: {
  orders: readonly ChurnNativeOrder[];
  dropoffEvents: readonly ChurnDropoffEvidence[];
  paidEvents: readonly PaidOrderEvent[];
  paymentProjections: readonly ChurnPaymentProjection[];
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

  const paymentByOrder = new Map(
    buildAuthoritativeNativePayments(input).map(payment => [
      payment.orderId,
      payment,
    ])
  );

  const history: AuthoritativeChurnObservation[] = [];
  for (const order of input.orders) {
    // A cancelled Laundry order is not completed-service history. Payment truth
    // remains a separate Money-domain claim and cannot resurrect service cadence.
    if (order.status === "cancelled") continue;
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
      valueCents: payment?.netPaidCents ?? null,
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
