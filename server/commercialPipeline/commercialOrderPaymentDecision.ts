import { nativeCapturedAmountCents } from "../domains/payment/nativePaymentReadService";
import { and, eq, isNull, or } from "drizzle-orm";
import { orderPaymentProjections, orders } from "../../drizzle/schema";
import {
  findAuthorityReceiptForSubjectWith,
  paymentAuthorityReceiptMatches,
  type AuthorityReceipt,
} from "../authority/authorityReceipt";

type PaymentReader = Parameters<typeof findAuthorityReceiptForSubjectWith>[0];
type NativeOrder = Pick<
  typeof orders.$inferSelect,
  "id" | "tenantId" | "paid" | "stripePaymentIntentId" | "status" | "paidAt"
>;
type Projection = Pick<
  typeof orderPaymentProjections.$inferSelect,
  | "tenantId"
  | "orderId"
  | "currency"
  | "state"
  | "capturedCents"
  | "refundedCents"
  | "netPaidCents"
>;

/** Historical null-tenant native orders belong only to the explicit Laundry Farm branch. */
export function commercialOrderTenantPredicate(tenantId: string) {
  if (!tenantId.trim())
    throw new Error("Commercial payment decision requires tenantId");
  return tenantId === "default"
    ? or(eq(orders.tenantId, tenantId), isNull(orders.tenantId))
    : eq(orders.tenantId, tenantId);
}

/** Provider net/refund projection takes precedence; absent one, an admitted native capture supplies the captured payment. Never order.total. */
export function decideCommercialOrderPayment(input: {
  tenantId: string;
  order: NativeOrder;
  receipt: AuthorityReceipt | null;
  projection: Projection | null;
}) {
  const { tenantId, order, receipt } = input;
  if (!tenantId.trim())
    throw new Error("Commercial payment decision requires tenantId");
  const orderTenantMatches =
    order.tenantId === tenantId ||
    (tenantId === "default" && order.tenantId === null);
  const projection =
    input.projection?.tenantId === tenantId &&
    input.projection.orderId === order.id
      ? input.projection
      : null;
  const authorized =
    orderTenantMatches &&
    Boolean(order.paid) &&
    Boolean(
      receipt &&
        paymentAuthorityReceiptMatches(receipt, {
          tenantId,
          subjectType: "order",
          subjectId: String(order.id),
          sourceType: "stripe_payment_intent",
          sourceRef: order.stripePaymentIntentId?.trim() || null,
        })
    );
  // A present refund/review projection must never be replaced by a gross capture.
  const capture = authorized ? nativeCapturedAmountCents(receipt) : null;
  const capturedOnly = projection === null && capture !== null;
  const knownNet = capturedOnly ? capture : projection?.netPaidCents ?? null;
  const validNet =
    knownNet !== null && Number.isSafeInteger(knownNet) && knownNet >= 0;
  const reversed =
    order.status === "cancelled" ||
    projection?.state === "cancelled" ||
    projection?.state === "refunded";
  const financialReview =
    !reversed &&
    (projection?.state === "review_required" ||
      (projection?.state === "partially_refunded" && !validNet) ||
      (authorized && !validNet));
  const paidCents =
    authorized &&
    !reversed &&
    !financialReview &&
    validNet &&
    (capturedOnly || projection?.state === "paid" || projection?.state === "partially_refunded")
      ? knownNet!
      : 0;
  return {
    paidCents,
    realizedCents: paidCents,
    status: reversed
      ? ("reversed" as const)
      : financialReview
        ? ("financial_review" as const)
        : ("active" as const),
    currency: projection?.currency ?? "usd",
    capturedCents: capturedOnly ? capture : projection?.capturedCents ?? null,
    refundedCents: projection?.refundedCents ?? null,
    netPaidCents: knownNet,
    paidAt: receipt?.occurredAt ? new Date(receipt.occurredAt) : null,
    financialReviewReason: financialReview
      ? "Canonical net amount is unavailable or requires financial review."
      : null,
  };
}

/** Transaction-scoped reads compose existing authority and projection facts; no new truth store. */
export async function readCommercialOrderPaymentDecisionWith(
  tx: PaymentReader,
  input: {
    tenantId: string;
    order: NativeOrder;
  }
) {
  const receipt = await findAuthorityReceiptForSubjectWith(tx, {
    tenantId: input.tenantId,
    claimType: "payment_verified",
    subjectType: "order",
    subjectId: String(input.order.id),
  });
  const [projection] = await tx
    .select()
    .from(orderPaymentProjections)
    .where(
      and(
        eq(orderPaymentProjections.tenantId, input.tenantId),
        eq(orderPaymentProjections.orderId, input.order.id)
      )
    )
    .limit(1)
    .for("update");
  return {
    decision: decideCommercialOrderPayment({
      ...input,
      receipt,
      projection: projection ?? null,
    }),
    receipt,
  };
}
