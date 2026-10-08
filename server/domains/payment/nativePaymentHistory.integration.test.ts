import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { orders, orderPaymentProjections } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { createNativeOrder } from "../../orders/orderLifecycleService";
import { projectCustomerAssets } from "../../customerAssets/customerAssetProjection";
import { admitNativeStripePayment } from "./paymentAdmission";

describe("native Payment history requires occurrence proof", () => {
  it("rejects a projection-only payment and preserves admitted history when current state changes", async () => {
    const db = (await getDb())!;
    const tenantId = `b4-${randomUUID().slice(0, 8)}`;
    const orderId = await createNativeOrder({
      tenantId,
      firstName: "B4",
      lastName: "Proof",
      phone: "3105550188",
      address: "3545 Wilshire Blvd",
      pickupDate: "2026-10-08",
      pickupTimeWindow: "9-11",
      total: "42.00",
    });
    const paidAt = new Date("2026-10-07T12:00:00Z");
    try {
      await db
        .update(orders)
        .set({ paid: true, stripePaymentIntentId: `pi_b4_${orderId}` })
        .where(eq(orders.id, orderId));
      await db
        .insert(orderPaymentProjections)
        .values({
          id: randomUUID(),
          tenantId,
          orderId,
          provider: "stripe",
          providerPaymentId: `pi_b4_${orderId}`,
          currency: "usd",
          state: "paid",
          netPaidCents: 4200,
          paidAt,
          lastReconciledAt: new Date(),
        });
      const [unadmitted] = await projectCustomerAssets({ tenantId });
      expect(
        unadmitted.timeline.filter(item => item.type === "payment")
      ).toEqual([]);
      const receipt = await admitNativeStripePayment({
        tenantId,
        orderId,
        paymentIntentId: `pi_b4_${orderId}`,
        paidAt,
        orderPatch: {},
      });
      for (const paid of [true, false]) {
        await db.update(orders).set({ paid }).where(eq(orders.id, orderId));
        const [asset] = await projectCustomerAssets({ tenantId });
        const payment = asset.timeline.filter(item => item.type === "payment");
        expect(payment).toHaveLength(1);
        expect(payment[0]).toMatchObject({
          occurredAt: paidAt.toISOString(),
          sourceReference: `authority_receipts:${receipt.id}`,
          verificationClass: "VERIFIED",
          amountCents: null,
        });
      }
    } finally {
      await db
        .delete(orderPaymentProjections)
        .where(eq(orderPaymentProjections.orderId, orderId));
      await db.delete(orders).where(eq(orders.id, orderId));
    }
  });
});
