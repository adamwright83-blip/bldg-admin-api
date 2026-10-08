import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { expect, it } from "vitest";
import { orders } from "../../drizzle/schema";
import { getDb } from "../db";
import {
  createNativeOrder,
  reviseNativeOrder,
} from "../orders/orderLifecycleService";
import {
  admitNativeStripePayment,
  reconcileNativeStripeCapture,
} from "../domains/payment/paymentAdmission";
import { readNativeResidentPaymentProjection } from "./nativeResidentPaymentProjection";
it("projects admitted resident counts independently of unknown capture amounts and fences tenant/value", async () => {
  const db = (await getDb())!;
  const tenantId = `c4-${randomUUID().slice(0, 8)}`,
    ids: number[] = [];
  const fixture = {
    firstName: "C4",
    lastName: "Resident",
    phone: "3105550124",
    address: "3545 Wilshire Blvd",
    pickupDate: "2026-10-08",
    pickupTimeWindow: "9-11",
    total: "90.00",
    bldgUserId: 101,
  };
  try {
    const first = await createNativeOrder({ ...fixture, tenantId });
    ids.push(first);
    await db
      .update(orders)
      .set({ paid: true, stripePaymentIntentId: `pi_c4_${first}` })
      .where(eq(orders.id, first));
    expect(await readNativeResidentPaymentProjection(tenantId)).toEqual([]);
    await admitNativeStripePayment({
      tenantId,
      orderId: first,
      paymentIntentId: `pi_c4_${first}`,
      paidAt: new Date(),
      orderPatch: {},
    });
    expect(await readNativeResidentPaymentProjection(tenantId)).toEqual([
      { bldgUserId: 101, paidOrderCount: 1, lifetimeValueCents: null },
    ]);
    for (let n = 1; n <= 2; n++) {
      const id = await createNativeOrder({ ...fixture, tenantId });
      ids.push(id);
      await admitNativeStripePayment({
        tenantId,
        orderId: id,
        paymentIntentId: `pi_c4_${id}`,
        paidAt: new Date(),
        orderPatch: {},
        capture: {
          paymentIntentId: `pi_c4_${id}`,
          status: "succeeded",
          amountReceivedCents: 4200,
          currency: "usd",
        },
      });
    }
    expect(
      (await readNativeResidentPaymentProjection(tenantId))[0]
    ).toMatchObject({ paidOrderCount: 3, lifetimeValueCents: null });
    await reconcileNativeStripeCapture({
      tenantId,
      orderId: first,
      capture: {
        paymentIntentId: `pi_c4_${first}`,
        status: "succeeded",
        amountReceivedCents: 4200,
        currency: "usd",
      },
    });
    await reviseNativeOrder(first, { total: "777.00" });
    const other = await createNativeOrder({
      ...fixture,
      tenantId: `${tenantId}-other`,
    });
    ids.push(other);
    await admitNativeStripePayment({
      tenantId: `${tenantId}-other`,
      orderId: other,
      paymentIntentId: `pi_c4_${other}`,
      paidAt: new Date(),
      orderPatch: {},
      capture: {
        paymentIntentId: `pi_c4_${other}`,
        status: "succeeded",
        amountReceivedCents: 9999,
        currency: "usd",
      },
    });
    for (let replay = 0; replay < 2; replay++)
      expect(await readNativeResidentPaymentProjection(tenantId)).toEqual([
        { bldgUserId: 101, paidOrderCount: 3, lifetimeValueCents: 12600 },
      ]);
    await expect(readNativeResidentPaymentProjection(" ")).rejects.toThrow(
      "tenant authority"
    );
  } finally {
    await db.delete(orders).where(inArray(orders.id, ids));
  }
});
