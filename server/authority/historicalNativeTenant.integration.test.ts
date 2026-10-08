import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { orders } from "../../drizzle/schema";
import { getDb } from "../db";
import { createNativeOrder } from "../orders/orderLifecycleService";
import { prepareNativeStripePaymentTenant, admitNativeStripePayment } from "./paymentAdmission";

it("holds missing historical ownership without changing tenant or admitting default payment", async () => {
  const db = (await getDb())!;
  const id = await createNativeOrder({ tenantId: `historical-${randomUUID().slice(0, 8)}`, firstName: "Historical", lastName: "Unknown", phone: "3105550151", address: "3545 Wilshire Blvd", pickupDate: "2026-10-08", pickupTimeWindow: "9-11" });
  try {
    await db.update(orders).set({ tenantId: null, paid: true, stripePaymentIntentId: `pi_history_${id}` }).where(eq(orders.id, id));
    await expect(prepareNativeStripePaymentTenant({ tenantId: "default", orderId: id })).rejects.toThrow("tenant authority is unresolved");
    await expect(admitNativeStripePayment({ tenantId: "default", orderId: id, paymentIntentId: `pi_history_${id}`, paidAt: new Date(), orderPatch: {} })).rejects.toThrow("Tenant order not found");
    const [after] = await db.select().from(orders).where(eq(orders.id, id));
    expect(after.tenantId).toBeNull();
  } finally { await db.delete(orders).where(eq(orders.id, id)); }
});
