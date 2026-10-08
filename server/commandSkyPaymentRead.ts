import { readNativeCustomerHistory } from "./domains/orders/orderHistoryReadService";
import { readNativePaymentFacts } from "./domains/payment/nativePaymentReadService";

/** First admitted native payment per customer phone; game state supplies no customer truth. */
export async function readCommandSkyFirstPayments(tenantId: string) {
  const orders = await readNativeCustomerHistory(tenantId);
  const facts = await readNativePaymentFacts(orders);
  const candidates = orders.flatMap(order => {
    const fact = facts.get(order.id);
    const phone = String(order.phone ?? "").replace(/\D/g, "");
    if (!fact?.occurredAt || !phone) return [];
    return [{ orderId: order.id, phone, occurredAt: fact.occurredAt,
      label: `${`${order.firstName ?? ""} ${order.lastName ?? ""}`.trim() || `…${phone.slice(-4)}`} — first order`,
      dedupeKey: `first-order:${phone}:${order.id}` }];
  }).sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.orderId - b.orderId);
  const seen = new Set<string>();
  return candidates.filter(candidate => {
    if (seen.has(candidate.phone)) return false;
    seen.add(candidate.phone); return true;
  });
}
