import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { orders } from "../../drizzle/schema";
import { getDb } from "../db";
import { createNativeOrder } from "../domains/orders/orderLifecycleService";
import { admitNativeStripePayment } from "../domains/payment/paymentAdmission";
import { getDataCompleteness } from "./analyticsQueries";

it("reports native payment connection only from owned admission, including unknown historical amounts", async () => {
  const tenantId = `coverage-${randomUUID().slice(0, 8)}`;
  const db = (await getDb())!;
  const id = await createNativeOrder({ tenantId, firstName: "Coverage", lastName: "Proof", phone: "3105550198", address: "100 Proof Street", pickupDate: "2026-10-08", pickupTimeWindow: "9-11", total: "90.00" });
  const paymentIntentId = `pi_coverage_${id}`;
  try {
    await db.update(orders).set({ paid: true, stripePaymentIntentId: paymentIntentId }).where(eq(orders.id, id));
    const connected = async (owner: string) => (await getDataCompleteness(owner)).connected.some(row => row.source === "Stripe-paid orders");
    expect(await connected(tenantId)).toBe(false);
    await admitNativeStripePayment({ tenantId, orderId: id, paymentIntentId, paidAt: new Date(), orderPatch: {} });
    expect(await connected(tenantId)).toBe(true);
    expect(await connected(`${tenantId}-other`)).toBe(false);
  } finally { await db.delete(orders).where(eq(orders.id, id)); }
});
