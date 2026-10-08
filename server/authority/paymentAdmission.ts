import { and, eq } from "drizzle-orm";
import { orders, authorityReceipts } from "../../drizzle/schema";
import { getDb } from "../db";
import {
  admitAuthorityClaimWith,
  paymentAuthorityReceiptMatches,
  type AuthorityReceipt,
  type AuthorityTransaction,
} from "./authorityReceipt";

const LEGACY_SINGLE_TENANT_ID = "default";

export async function prepareNativeStripePaymentTenant(input: {
  tenantId: string;
  orderId: number;
}): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const tenantId = input.tenantId.trim();
  if (!tenantId) throw new Error("Stripe payment admission requires tenantId");

  return db.transaction(async tx => {
    const [order] = await tx
      .select({ id: orders.id, tenantId: orders.tenantId })
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .for("update")
      .limit(1);
    if (!order) throw new Error("Tenant order not found for payment admission");

    const persistedOrderTenantId = order.tenantId?.trim();
    if (!persistedOrderTenantId) {
      if (tenantId !== LEGACY_SINGLE_TENANT_ID) {
        throw new Error("Tenant order not found for payment admission");
      }
      await tx
        .update(orders)
        .set({ tenantId: LEGACY_SINGLE_TENANT_ID })
        .where(eq(orders.id, input.orderId));
      return LEGACY_SINGLE_TENANT_ID;
    }

    if (persistedOrderTenantId !== tenantId) {
      throw new Error("Tenant order not found for payment admission");
    }

    return persistedOrderTenantId;
  });
}

export async function admitNativeStripePayment(input: {
  tenantId: string;
  orderId: number;
  paymentIntentId: string;
  paidAt: Date;
  orderPatch: Partial<typeof orders.$inferInsert>;
  actorId?: string | null;
  capture?: StripeCaptureEvidence;
}): Promise<AuthorityReceipt> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const tenantId = input.tenantId.trim();
  const paymentIntentId = input.paymentIntentId.trim();
  if (!tenantId) throw new Error("Stripe payment admission requires tenantId");
  if (!paymentIntentId)
    throw new Error("Stripe payment admission requires PaymentIntent evidence");

  if (input.capture) validateStripeCapture(input.capture, paymentIntentId);

  return db.transaction(async tx => {
    const [order] = await tx
      .select({ id: orders.id, tenantId: orders.tenantId })
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, tenantId)))
      .for("update")
      .limit(1);
    if (!order) throw new Error("Tenant order not found for payment admission");

    let receipt = await admitAuthorityClaimWith(tx, {
      tenantId,
      claimType: "payment_verified",
      subjectType: "order",
      subjectId: String(input.orderId),
      sourceType: "stripe_payment_intent",
      sourceRef: paymentIntentId,
      actorType: "system",
      actorId: input.actorId ?? null,
      evidenceClass: "authoritative_external",
      verificationClass: "VERIFIED",
      admissionPolicy: "native_stripe_payment_v1",
      occurredAt: input.paidAt,
      metadata: { orderId: input.orderId },
    });

    if (input.capture)
      receipt = await persistStripeCapture(tx, receipt, input.capture);

    await tx
      .update(orders)
      .set({
        ...input.orderPatch,
        paid: true,
        paidAt: input.paidAt,
        stripePaymentIntentId: paymentIntentId,
      })
      .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, tenantId)));

    return receipt;
  });
}

export type StripeCaptureEvidence = {
  paymentIntentId: string;
  status: string;
  amountReceivedCents: number;
  currency: string;
};
function validateStripeCapture(
  capture: StripeCaptureEvidence,
  paymentIntentId: string
) {
  if (
    capture.paymentIntentId !== paymentIntentId ||
    capture.status !== "succeeded" ||
    !Number.isSafeInteger(capture.amountReceivedCents) ||
    capture.amountReceivedCents < 0 ||
    !/^[a-z]{3}$/.test(capture.currency)
  )
    throw new Error(
      "Payment capture requires matching succeeded provider evidence"
    );
}
async function persistStripeCapture(
  tx: AuthorityTransaction,
  receipt: AuthorityReceipt,
  capture: StripeCaptureEvidence
): Promise<AuthorityReceipt> {
  validateStripeCapture(capture, receipt.sourceRef);
  const metadata = receipt.metadata ?? {};
  if (
    metadata.capturedAmountCents !== undefined &&
    (metadata.capturedAmountCents !== capture.amountReceivedCents ||
      metadata.capturedCurrency !== capture.currency)
  )
    throw new Error(
      "Provider capture conflicts with immutable admitted amount"
    );
  const next = {
    ...metadata,
    capturedAmountCents: capture.amountReceivedCents,
    capturedCurrency: capture.currency,
    captureEvidence: "stripe_amount_received_v1",
  };
  await tx
    .update(authorityReceipts)
    .set({ metadataJson: next })
    .where(
      and(
        eq(authorityReceipts.id, receipt.id),
        eq(authorityReceipts.tenantId, receipt.tenantId)
      )
    );
  return { ...receipt, metadata: next };
}
/** Reconcile an existing receipt from provider capture evidence without changing current paid/refund state. */
export async function reconcileNativeStripeCapture(input: {
  tenantId: string;
  orderId: number;
  capture: StripeCaptureEvidence;
}): Promise<AuthorityReceipt> {
  if (!input.tenantId.trim())
    throw new Error("Capture reconciliation requires tenant authority");
  validateStripeCapture(input.capture, input.capture.paymentIntentId);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(
        and(eq(orders.id, input.orderId), eq(orders.tenantId, input.tenantId))
      )
      .for("update")
      .limit(1);
    if (!order || order.stripePaymentIntentId !== input.capture.paymentIntentId)
      throw new Error("Provider capture does not match tenant order");
    const [row] = await tx
      .select()
      .from(authorityReceipts)
      .where(
        and(
          eq(authorityReceipts.tenantId, input.tenantId),
          eq(authorityReceipts.subjectId, String(input.orderId)),
          eq(authorityReceipts.sourceRef, input.capture.paymentIntentId),
          eq(authorityReceipts.claimType, "payment_verified")
        )
      )
      .for("update")
      .limit(1);
    if (!row)
      throw new Error(
        "Existing payment admission receipt required for reconciliation"
      );
    const receipt = {
      ...row,
      metadata: row.metadataJson,
    } as unknown as AuthorityReceipt;
    if (
      !paymentAuthorityReceiptMatches(receipt, {
        tenantId: input.tenantId,
        subjectType: "order",
        subjectId: String(input.orderId),
        sourceType: "stripe_payment_intent",
        sourceRef: input.capture.paymentIntentId,
      })
    )
      throw new Error("Invalid payment admission receipt");
    return persistStripeCapture(tx, receipt, input.capture);
  });
}
