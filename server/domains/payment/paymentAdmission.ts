import { and, eq } from "drizzle-orm";
import { orders, authorityReceipts } from "../../../drizzle/schema";
import { getDb } from "../../db";
import {
  admitAuthorityClaimWith,
  paymentAuthorityReceiptMatches,
  type AuthorityReceipt,
  type AuthorityTransaction,
} from "../../platform/authority/authorityReceipt";
import {
  admitOrderProcessingStatusInTransaction,
  type PaymentAdmissionStatusDisposition,
} from "../orders/orderLifecycleService";

export const AUTHORIZED_PAYMENT_ORDER_PATCH_KEYS = [
  "total",
  "isFirstPaidOrder",
  "platformFeeCents",
  "vendorPayoutCents",
  "stripeConnectedAccountIdSnapshot",
  "vendorNameSnapshot",
  "routingPrioritySnapshot",
] as const;

export type AuthorizedPaymentOrderPatchKey =
  typeof AUTHORIZED_PAYMENT_ORDER_PATCH_KEYS[number];

export type NativeStripePaymentOrderPatch = {
  total?: string;
  isFirstPaidOrder?: boolean;
  platformFeeCents?: number | null;
  vendorPayoutCents?: number | null;
  stripeConnectedAccountIdSnapshot?: string | null;
  vendorNameSnapshot?: string | null;
  routingPrioritySnapshot?: number | null;
};

export type NativePaymentAdmissionResult = AuthorityReceipt & {
  statusDisposition: PaymentAdmissionStatusDisposition;
};

export function validatePaymentOrderPatch(
  orderPatch: Record<string, unknown> | undefined
): void {
  if (!orderPatch) return;
  const patchKeys = Object.keys(orderPatch);
  for (const key of patchKeys) {
    if (
      !(AUTHORIZED_PAYMENT_ORDER_PATCH_KEYS as readonly string[]).includes(key)
    ) {
      throw new Error(
        `Unauthorized field '${key}' in payment admission orderPatch. Payment admission only permits: ${AUTHORIZED_PAYMENT_ORDER_PATCH_KEYS.join(", ")}.`
      );
    }
  }
}

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
      throw new Error("Historical order tenant authority is unresolved; establish ownership before payment admission.");
    }

    if (persistedOrderTenantId !== tenantId) {
      throw new Error("Tenant order not found for payment admission");
    }

    return persistedOrderTenantId;
  });
}

/** Lock provider occurrence identity before admitting a whole native capture to an Order. */
async function lockNativeProviderBinding(tx: AuthorityTransaction, tenantId: string, orderId: number, paymentIntentId: string) {
  const existing = await tx.select().from(authorityReceipts).where(and(
    eq(authorityReceipts.claimType, "payment_verified"),
    eq(authorityReceipts.subjectType, "order"),
    eq(authorityReceipts.sourceType, "stripe_payment_intent"),
    eq(authorityReceipts.sourceRef, paymentIntentId)
  )).for("update").limit(2);
  if (existing.some(row => row.tenantId !== tenantId || row.subjectId !== String(orderId)))
    throw new Error("Provider capture is already bound to another native order; allocation is unknown.");
  return existing.length > 0;
}

export async function admitNativeStripePayment(input: {
  tenantId: string;
  orderId: number;
  paymentIntentId: string;
  paidAt: Date;
  orderPatch?: NativeStripePaymentOrderPatch;
  actorId?: string | null;
  capture?: StripeCaptureEvidence;
}): Promise<NativePaymentAdmissionResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const tenantId = input.tenantId.trim();
  const paymentIntentId = input.paymentIntentId.trim();
  if (!tenantId) throw new Error("Stripe payment admission requires tenantId");
  if (!paymentIntentId)
    throw new Error("Stripe payment admission requires PaymentIntent evidence");

  validatePaymentOrderPatch(input.orderPatch as Record<string, unknown>);
  validateCaptureOwnership(input.capture, tenantId, input.orderId);
  if (input.capture) validateStripeCapture(input.capture, paymentIntentId);

  return db.transaction(async tx => {
    const [order] = await tx
      .select({
        id: orders.id,
        tenantId: orders.tenantId,
        paid: orders.paid,
        stripePaymentIntentId: orders.stripePaymentIntentId,
        status: orders.status,
      })
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, tenantId)))
      .for("update")
      .limit(1);
    if (!order) throw new Error("Tenant order not found for payment admission");

    if (order.stripePaymentIntentId && order.stripePaymentIntentId !== paymentIntentId)
      throw new Error("Provider capture cannot replace the native order payment identity.");
    const replay = await lockNativeProviderBinding(tx, tenantId, input.orderId, paymentIntentId);
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

    // Payment domain exclusively controls paid, paidAt, and stripePaymentIntentId,
    // plus the allowlisted financial snapshot fields from orderPatch.
    // Payment domain does NOT assign or touch status.
    const sanitizedPatch: Partial<typeof orders.$inferInsert> = {};
    if (input.orderPatch) {
      for (const key of AUTHORIZED_PAYMENT_ORDER_PATCH_KEYS) {
        if (key in input.orderPatch && (input.orderPatch as any)[key] !== undefined) {
          (sanitizedPatch as any)[key] = (input.orderPatch as any)[key];
        }
      }
    }

    await tx
      .update(orders)
      .set({
        ...sanitizedPatch,
        paid: replay && order.paid === false ? false : true,
        paidAt: input.paidAt,
        stripePaymentIntentId: paymentIntentId,
      })
      .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, tenantId)));

    // Orders domain owns status transition via narrow transactional helper
    const statusDisposition = await admitOrderProcessingStatusInTransaction(
      tx,
      order,
      tenantId
    );

    return Object.assign(receipt, { statusDisposition });
  });
}

export type StripeCaptureEvidence = {
  paymentIntentId: string;
  status: string;
  amountReceivedCents: number;
  currency: string;
  providerOrderId?: string;
  providerTenantId?: string;
};
function validateCaptureOwnership(capture: StripeCaptureEvidence | undefined, tenantId: string, orderId: number) {
  if ((capture?.providerOrderId && capture.providerOrderId !== String(orderId)) ||
      (capture?.providerTenantId && capture.providerTenantId !== tenantId))
    throw new Error("Provider capture metadata conflicts with native order ownership.");
}
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
  validateCaptureOwnership(input.capture, input.tenantId, input.orderId);
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
    await lockNativeProviderBinding(tx, input.tenantId, input.orderId, input.capture.paymentIntentId);
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
