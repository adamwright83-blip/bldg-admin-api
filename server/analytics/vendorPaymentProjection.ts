import { getVendorById } from "../db";
import type { Order } from "../../drizzle/schema";
import {
  readNativePaymentFacts,
  type NativePaymentFact,
} from "../domains/payment/nativePaymentReadService";
import { readNativeOrdersForVendor } from "../domains/orders/orderHistoryReadService";

export type VendorPaymentProjection = {
  order: Order;
  authorityReceiptId: string;
  paymentOccurredAt: string | null;
  capturedAmountCents: number | null;
  platformFeeCents: number | null;
  payoutCents: number | null;
  /** Current order paid/refund projection; historical capture occurrence remains separate. */
  currentPaid: boolean;
};

/**
 * Vendor economics are a downstream projection of Orders assignment + Payment admission.
 * Current order price/updatedAt/paid flags are never historical amount/time authority.
 */
export function projectVendorPayments(
  orders: readonly Order[],
  paymentFacts: ReadonlyMap<number, NativePaymentFact>,
  recipientAccountId?: string | null
): VendorPaymentProjection[] {
  return orders
    .flatMap(order => {
      const fact = paymentFacts.get(order.id);
      if (!fact) return [];
      const capturedAmountCents = fact.capturedAmountCents;
      const platformFeeCents =
        capturedAmountCents != null && order.platformFeeCents != null &&
        recipientAccountId && order.stripeConnectedAccountIdSnapshot === recipientAccountId
          ? order.platformFeeCents
          : null;
      const payoutCents =
        capturedAmountCents != null && platformFeeCents != null
          ? Math.max(0, capturedAmountCents - platformFeeCents)
          : null;
      return [
        {
          order,
          authorityReceiptId: fact.authorityReceiptId,
          paymentOccurredAt: fact.occurredAt,
          capturedAmountCents,
          platformFeeCents,
          payoutCents,
          currentPaid: order.paid === true,
        },
      ];
    })
    .sort(
      (a, b) =>
        Date.parse(b.paymentOccurredAt ?? "1970-01-01") -
          Date.parse(a.paymentOccurredAt ?? "1970-01-01") ||
        b.order.id - a.order.id
    );
}

export async function loadVendorPaymentProjection(
  vendorId: number
): Promise<VendorPaymentProjection[]> {
  const orders = await readNativeOrdersForVendor(vendorId);
  const facts = await readNativePaymentFacts(orders);
  const vendor = await getVendorById(vendorId);
  return projectVendorPayments(orders, facts, vendor?.stripeConnectAccountId);
}

export function sumKnownCents(values: readonly (number | null)[]): number | null {
  if (values.some(value => value == null)) return null;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}
