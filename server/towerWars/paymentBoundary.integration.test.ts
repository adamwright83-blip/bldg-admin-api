import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { orders } from "../../drizzle/schema";
import { getDb } from "../db";
import {
  createNativeOrder,
  reviseNativeOrder,
} from "../domains/orders/orderLifecycleService";
import {
  admitNativeStripePayment,
  reconcileNativeStripeCapture,
} from "../domains/payment/paymentAdmission";
import {
  loadTowerWarsEconomicCandidates,
  compileAuthoritativeEvents,
} from "./towerWarsService";
it("bridges only admitted captured dollars into Tower Wars, with price/replay/tenant invariance", async () => {
  const db = (await getDb())!;
  const tenantId = `b5-${randomUUID().slice(0, 8)}`;
  const orderId = await createNativeOrder({
    tenantId,
    firstName: "B5",
    lastName: "Bridge",
    phone: "3105550133",
    address: "3545 Wilshire Blvd",
    pickupDate: "2026-10-08",
    pickupTimeWindow: "9-11",
    total: "90.00",
  });
  const start = new Date("2026-10-07T00:00:00Z"),
    end = new Date("2026-10-08T00:00:00Z"),
    paidAt = new Date("2026-10-07T12:00:00Z");
  try {
    await db
      .update(orders)
      .set({ paid: true, paidAt, stripePaymentIntentId: `pi_b5_${orderId}` })
      .where(eq(orders.id, orderId));
    expect(await loadTowerWarsEconomicCandidates(tenantId, start, end)).toEqual(
      []
    );
    await admitNativeStripePayment({
      tenantId,
      orderId,
      paymentIntentId: `pi_b5_${orderId}`,
      paidAt,
      orderPatch: {},
    });
    expect(await loadTowerWarsEconomicCandidates(tenantId, start, end)).toEqual(
      []
    );
    await reconcileNativeStripeCapture({
      tenantId,
      orderId,
      capture: {
        paymentIntentId: `pi_b5_${orderId}`,
        status: "succeeded",
        amountReceivedCents: 4200,
        currency: "usd",
      },
    });
    const before = await loadTowerWarsEconomicCandidates(tenantId, start, end);
    expect(before).toHaveLength(1);
    expect(before[0].cents).toBe(4200);
    await reviseNativeOrder(orderId, { total: "150.00" });
    const after = await loadTowerWarsEconomicCandidates(tenantId, start, end);
    expect(after).toEqual(before);
    const compiled = compileAuthoritativeEvents({
      tenantId,
      businessDate: "2026-10-07",
      candidates: after,
    });
    expect(compiled.events).toHaveLength(1);
    expect(compiled.events[0].realOrderValueCents).toBe(4200);
    expect(
      await loadTowerWarsEconomicCandidates("other-tenant", start, end)
    ).toEqual([]);
  } finally {
    await db.delete(orders).where(eq(orders.id, orderId));
  }
});
