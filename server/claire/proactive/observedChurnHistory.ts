/**
 * Build churn evidence only from actual admitted paid-order observations.
 * The churn scoring contract uses a numeric order ID. When a provider cannot
 * supply one unambiguously, abstain instead of manufacturing IDs or history.
 */
import type { PaidOrderEvent } from "../../analytics/paidOrderLedger";
import type { CustomerHistoryObservation } from "../../../shared/customerChurn";

export function observedChurnHistory(
  records: readonly PaidOrderEvent[]
): CustomerHistoryObservation[] | null {
  const paid = records.filter(r => r.cents > 0);
  if (paid.length < 2) return null;
  const seen = new Set<number>();
  const history: CustomerHistoryObservation[] = [];
  for (const record of paid) {
    const id = record.orderNumber?.trim();
    if (!id || !/^[1-9]\d*$/.test(id) || !record.serviceType ||
        !Number.isFinite(record.cents) || !Number.isFinite(record.occurredAt.getTime())) {
      return null;
    }
    const orderId = Number(id);
    if (!Number.isSafeInteger(orderId) || seen.has(orderId)) return null;
    seen.add(orderId);
    history.push({
      orderId,
      serviceAt: record.occurredAt,
      valueCents: record.cents,
      weightLbs: null,
      serviceType: record.serviceType,
    });
  }
  return history.sort((a,b) =>
    new Date(a.serviceAt).getTime() - new Date(b.serviceAt).getTime());
}
