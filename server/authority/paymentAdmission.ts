import { and, eq } from "drizzle-orm";
import { orders } from "../../drizzle/schema";
import { getDb } from "../db";
import { admitAuthorityClaimWith, type AuthorityReceipt } from "./authorityReceipt";

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
}): Promise<AuthorityReceipt> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const tenantId = input.tenantId.trim();
  const paymentIntentId = input.paymentIntentId.trim();
  if (!tenantId) throw new Error("Stripe payment admission requires tenantId");
  if (!paymentIntentId)
    throw new Error("Stripe payment admission requires PaymentIntent evidence");

  return db.transaction(async tx => {
    const [order] = await tx
      .select({ id: orders.id, tenantId: orders.tenantId })
      .from(orders)
      .where(
        and(
          eq(orders.id, input.orderId),
          eq(orders.tenantId, tenantId)
        )
      )
      .for("update")
      .limit(1);
    if (!order) throw new Error("Tenant order not found for payment admission");

    const receipt = await admitAuthorityClaimWith(tx, {
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

    await tx
      .update(orders)
      .set({
        ...input.orderPatch,
        paid: true,
        paidAt: input.paidAt,
        stripePaymentIntentId: paymentIntentId,
      })
      .where(
        and(
          eq(orders.id, input.orderId),
          eq(orders.tenantId, tenantId)
        )
      );

    return receipt;
  });
}
