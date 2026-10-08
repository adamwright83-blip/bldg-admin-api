import { listCustomerAssets } from "../customerAssets/customerAssetProjection";
import { getMoneyProjection } from "../money/moneyProjectionService";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { orders } from "../../drizzle/schema";
import { getDb } from "../db";
import { createNativeOrder } from "../orders/orderLifecycleService";
import { admitNativeStripePayment } from "./paymentAdmission";
import { readNativePaymentAuthorityReceipts } from "./nativePaymentReadService";
import { loadCustomerOrderTruth } from "../geography/customerOrderTruth";

describe("real MySQL Payment → customer/game projection", () => {
  it("withholds historical weak paid state until exact canonical Payment admission", async () => {
    const db = (await getDb())!;
    const tenantId = `b2-${randomUUID().slice(0, 8)}`;
    const orderId = await createNativeOrder({
      tenantId,
      firstName: "B2",
      lastName: "Proof",
      phone: "3105550199",
      address: "3545 Wilshire Blvd",
      pickupDate: "2026-10-08",
      pickupTimeWindow: "9-11",
      total: "42.00",
    });
    try {
      // Simulate a historical/bypassed flag. Test fixture only, not an application write.
      await db
        .update(orders)
        .set({ paid: true, stripePaymentIntentId: "pi_b2_proof" })
        .where(eq(orders.id, orderId));
      const [row] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, orderId));
      expect((await readNativePaymentAuthorityReceipts([row])).size).toBe(0);
      expect((await loadCustomerOrderTruth(tenantId))[0]?.paid).toBe(false);
      const [unverifiedAsset] = await listCustomerAssets({ tenantId });
      expect(unverifiedAsset.lifetimeValue.value).toBeNull();
      expect(unverifiedAsset.outstandingReceivables.value).toBeNull();
      expect(
        (await getMoneyProjection({ tenantId })).receivables.value
      ).toBeNull();
      await admitNativeStripePayment({
        tenantId,
        orderId,
        paymentIntentId: "pi_b2_proof",
        paidAt: new Date(),
        orderPatch: {},
      });
      expect(
        (await readNativePaymentAuthorityReceipts([row])).has(orderId)
      ).toBe(true);
      expect((await loadCustomerOrderTruth(tenantId))[0]?.paid).toBe(true);
      const [verifiedAsset] = await listCustomerAssets({ tenantId });
      expect(verifiedAsset.lifetimeValue.value).toBe(4200);
      expect(verifiedAsset.outstandingReceivables.value).toBe(0);
      expect(
        (
          await readNativePaymentAuthorityReceipts([
            { ...row, tenantId: "other-tenant" },
          ])
        ).size
      ).toBe(0);
    } finally {
      await db.delete(orders).where(eq(orders.id, orderId));
    }
  });
});
